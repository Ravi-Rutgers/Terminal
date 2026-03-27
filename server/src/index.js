require('dotenv').config();

const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');
const { ensureCerts } = require('./certgen');
const { authenticate, verifyToken, authMiddleware } = require('./auth');
const terminal = require('./terminal');
const pixelAgents = require('./pixelAgents');
const { getSystemInfo } = require('./sysinfo');
const files = require('./files');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT) || 3443;
const app = express();

// CORS — allow web client from any origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// --- Health check (no auth) ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', name: 'Hussle Terminal Server', uptime: process.uptime() });
});

// --- Auth endpoint (no middleware) ---
app.post('/auth', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  const token = authenticate(password);
  if (!token) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token });
});

// --- GitHub OAuth config (no auth — app needs client_id before login) ---
app.get('/api/github/config', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.status(404).json({ error: 'GitHub OAuth not configured' });
  res.json({ client_id: clientId });
});

// --- GitHub OAuth token exchange (no auth — called during GitHub login) ---
app.post('/api/github/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'GitHub OAuth not configured on server' });
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const data = await response.json();
    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }
    res.json({ access_token: data.access_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- All other routes require auth ---
app.use('/api', authMiddleware);

// --- Terminal session REST endpoints ---
app.get('/api/sessions', (req, res) => {
  res.json(terminal.listSessions());
});

app.post('/api/sessions', (req, res) => {
  const { workdir } = req.body || {};
  const session = terminal.createSession(workdir);
  res.status(201).json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  const ok = terminal.killSession(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

app.get('/api/sessions/:id/logs', (req, res) => {
  const logs = terminal.getSessionLogs(req.params.id);
  if (logs === null) return res.status(404).json({ error: 'Session not found' });
  res.json({ logs });
});

// --- Pixel Agent Desk proxy ---
app.get('/api/agents', async (req, res) => {
  const result = await pixelAgents.getAgents();
  if (!result.ok) return res.status(503).json({ error: result.error, data: [] });
  res.json(result.data);
});

app.get('/api/agents/stats', async (req, res) => {
  const result = await pixelAgents.getStats();
  if (!result.ok) return res.status(503).json({ error: result.error, data: null });
  res.json(result.data);
});

app.get('/api/agents/sessions', async (req, res) => {
  const result = await pixelAgents.getSessions();
  if (!result.ok) return res.status(503).json({ error: result.error, data: [] });
  res.json(result.data);
});

app.get('/api/agents/heatmap', async (req, res) => {
  const result = await pixelAgents.getHeatmap();
  if (!result.ok) return res.status(503).json({ error: result.error, data: null });
  res.json(result.data);
});

app.get('/api/agents/health', async (req, res) => {
  const result = await pixelAgents.getHealth();
  res.json({ running: result.ok, ...(result.ok ? result.data : {}) });
});

app.get('/api/agents/:id', async (req, res) => {
  const result = await pixelAgents.getAgentDetail(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result.data);
});

app.get('/api/agents/:id/history', async (req, res) => {
  const result = await pixelAgents.getAgentHistory(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result.data);
});

// --- System info ---
app.get('/api/system', async (req, res) => {
  try {
    const info = await getSystemInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Project creation ---
app.post('/api/project', (req, res) => {
  const { name, parentDir } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });

  const base = parentDir || process.env.USERPROFILE || process.env.HOME;
  const projectPath = path.join(base, name);

  if (fs.existsSync(projectPath)) {
    return res.status(409).json({ error: 'Directory already exists', path: projectPath });
  }

  fs.mkdirSync(projectPath, { recursive: true });
  res.status(201).json({ ok: true, path: projectPath });
});

// --- File system endpoints ---
app.get('/api/files/list', (req, res) => {
  const dirPath = req.query.path || process.env.USERPROFILE || process.env.HOME;
  const result = files.listDirectory(dirPath);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/files/browse', (req, res) => {
  const dirPath = req.query.path || process.env.USERPROFILE || process.env.HOME;
  const result = files.browseDirs(dirPath);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/files/read', (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' });
  const result = files.readFile(req.query.path);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/files/write', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (content === undefined) return res.status(400).json({ error: 'content required' });
  const result = files.writeFile(filePath, content);
  res.json(result);
});

app.post('/api/files/create', (req, res) => {
  const { path: filePath, isDirectory } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  const result = isDirectory ? files.createDir(filePath) : files.createFile(filePath);
  if (result.error) return res.status(409).json(result);
  res.status(201).json(result);
});

app.delete('/api/files', (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' });
  const result = files.deleteItem(req.query.path);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/files/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
  const result = files.renameItem(oldPath, newPath);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// --- Git endpoints ---
const { execFile } = require('child_process');

function runGit(args, cwd, res) {
  execFile('git', args, { cwd, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ output: stdout });
  });
}

app.get('/api/git/status', (req, res) => {
  const dir = req.query.path;
  if (!dir) return res.status(400).json({ error: 'path required' });
  execFile('git', ['status', '--porcelain'], { cwd: dir, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ output: stdout });
  });
});

app.get('/api/git/diff', (req, res) => {
  const dir = req.query.path;
  const file = req.query.file;
  if (!dir) return res.status(400).json({ error: 'path required' });
  const args = ['diff'];
  if (file) args.push('--', file);
  runGit(args, dir, res);
});

app.get('/api/git/diff-staged', (req, res) => {
  const dir = req.query.path;
  const file = req.query.file;
  if (!dir) return res.status(400).json({ error: 'path required' });
  const args = ['diff', '--cached'];
  if (file) args.push('--', file);
  runGit(args, dir, res);
});

app.get('/api/git/log', (req, res) => {
  const dir = req.query.path;
  const n = Math.min(parseInt(req.query.n) || 10, 100);
  if (!dir) return res.status(400).json({ error: 'path required' });
  runGit(['log', `--pretty=format:%H||%an||%ar||%s`, `-${n}`, '--stat'], dir, res);
});

app.get('/api/git/numstat', (req, res) => {
  const dir = req.query.path;
  if (!dir) return res.status(400).json({ error: 'path required' });
  execFile('git', ['diff', '--numstat'], { cwd: dir, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    // Also get staged changes
    execFile('git', ['diff', '--cached', '--numstat'], { cwd: dir, maxBuffer: 1024 * 1024 }, (err2, stdoutStaged) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ unstaged: stdout, staged: stdoutStaged || '' });
    });
  });
});

// --- Start server (HTTP for local dev, HTTPS for production) ---
const http = require('http');
const USE_HTTPS = process.env.USE_HTTPS === 'true';
let server;
if (USE_HTTPS) {
  const { key, cert } = ensureCerts();
  server = https.createServer({ key, cert }, app);
} else {
  server = http.createServer(app);
}

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract token from query string
  const protocol = USE_HTTPS ? 'https' : 'http';
  const url = new URL(req.url, `${protocol}://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token || !verifyToken(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'subscribe': {
        const ok = terminal.subscribe(msg.sessionId, ws);
        if (!ok) ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
        break;
      }
      case 'terminal/input': {
        const ok = terminal.writeToSession(msg.sessionId, msg.data);
        if (!ok) ws.send(JSON.stringify({ type: 'error', message: 'Session not found or inactive' }));
        break;
      }
      case 'terminal/resize': {
        terminal.resizeSession(msg.sessionId, msg.cols, msg.rows);
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    terminal.unsubscribeAll(ws);
  });

  // Send current session list on connect
  ws.send(JSON.stringify({ type: 'session/list', sessions: terminal.listSessions() }));
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  const proto = USE_HTTPS ? 'https' : 'http';
  console.log(`Hussle Terminal Server running on ${proto}://localhost:${PORT}`);
});
