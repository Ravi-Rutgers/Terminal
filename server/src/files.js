const fs = require('fs');
const path = require('path');

function listDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { error: 'Directory not found' };
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return { error: 'Not a directory' };
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    // Skip hidden/system files
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;

    try {
      const fullPath = path.join(dirPath, entry.name);
      const s = fs.statSync(fullPath);
      items.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : s.size,
        modified: s.mtime.toISOString(),
      });
    } catch {
      // Permission denied, skip
    }
  }

  // Sort: directories first, then alphabetical
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: dirPath, items };
}

function browseDirs(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { error: 'Directory not found' };
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const dirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    dirs.push({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    });
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    current: dirPath,
    parent: path.dirname(dirPath) !== dirPath ? path.dirname(dirPath) : null,
    dirs,
  };
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'File not found' };
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { error: 'Is a directory' };
  }
  if (stat.size > 2 * 1024 * 1024) {
    return { error: 'File too large (>2MB)' };
  }

  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.exe', '.dll', '.zip', '.tar', '.gz'];
  if (binaryExts.includes(ext)) {
    return { error: 'Binary file', binary: true };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return {
    path: filePath,
    name: path.basename(filePath),
    content,
    size: stat.size,
    language: getLanguage(ext),
  };
}

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true, path: filePath };
}

function createFile(filePath) {
  if (fs.existsSync(filePath)) {
    return { error: 'File already exists' };
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
  return { ok: true, path: filePath };
}

function createDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    return { error: 'Directory already exists' };
  }
  fs.mkdirSync(dirPath, { recursive: true });
  return { ok: true, path: dirPath };
}

function deleteItem(itemPath) {
  if (!fs.existsSync(itemPath)) {
    return { error: 'Not found' };
  }
  const stat = fs.statSync(itemPath);
  if (stat.isDirectory()) {
    fs.rmSync(itemPath, { recursive: true });
  } else {
    fs.unlinkSync(itemPath);
  }
  return { ok: true };
}

function renameItem(oldPath, newPath) {
  if (!fs.existsSync(oldPath)) {
    return { error: 'Not found' };
  }
  if (fs.existsSync(newPath)) {
    return { error: 'Target already exists' };
  }
  fs.renameSync(oldPath, newPath);
  return { ok: true, path: newPath };
}

function getLanguage(ext) {
  const map = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rs': 'rust', '.go': 'go',
    '.html': 'html', '.css': 'css', '.scss': 'scss',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.txt': 'plaintext',
    '.sh': 'shell', '.bash': 'shell',
    '.toml': 'toml', '.xml': 'xml', '.svg': 'xml',
    '.sql': 'sql', '.env': 'plaintext',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c',
    '.java': 'java', '.kt': 'kotlin',
    '.rb': 'ruby', '.php': 'php',
    '.swift': 'swift', '.dart': 'dart',
  };
  return map[ext] || 'plaintext';
}

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB

function downloadFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'File not found', status: 404 };
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { error: 'Is a directory', status: 400 };
  }
  if (stat.size > MAX_DOWNLOAD_SIZE) {
    return { error: 'File too large (>50MB)', status: 413 };
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const name = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  return { buffer, mimeType, name, size: stat.size };
}

module.exports = {
  listDirectory,
  browseDirs,
  readFile,
  writeFile,
  createFile,
  createDir,
  deleteItem,
  renameItem,
  downloadFile,
};
