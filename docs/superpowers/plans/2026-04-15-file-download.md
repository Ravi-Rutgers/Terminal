# File Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bestanden van de server downloaden naar iPhone — foto's/video's naar Camera Roll, overige bestanden via share sheet naar Files app.

**Architecture:** Nieuw `GET /api/files/download` endpoint op de server stuurt elk bestandstype als binary. Op de iPhone downloadt `expo-file-system` naar een tijdelijk pad, waarna `expo-media-library` (foto/video) of `expo-sharing` (rest) het bestand opslaat. De "Downloaden" optie verschijnt in het bestaande 3-dots context menu in de editor.

**Tech Stack:** Node.js/Express (server), React Native + Expo SDK 54, expo-file-system, expo-media-library, expo-sharing, TypeScript

---

## File Map

| Actie | Bestand | Verantwoordelijkheid |
|---|---|---|
| Modify | `server/src/files.js` | Voeg `downloadFile()` toe + MIME-type map |
| Modify | `server/src/index.js` | Voeg `GET /api/files/download` route toe |
| Create | `mobile/utils/downloadFile.ts` | Download utility: fetch → opslaan → opruimen |
| Modify | `mobile/app/(tabs)/editor.tsx` | Download handler + UI state + context menu optie |

---

## Task 1: Server — `downloadFile()` in files.js

**Files:**
- Modify: `server/src/files.js`

- [ ] **Stap 1: Voeg MIME-type map en `downloadFile()` toe aan `server/src/files.js`**

Voeg toe aan het einde van het bestand, vóór `module.exports`:

```js
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
```

Update `module.exports` onderaan het bestand:

```js
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
```

- [ ] **Stap 2: Commit**

```bash
rtk git add server/src/files.js
rtk git commit -m "feat: add downloadFile() to files.js with MIME type mapping"
```

---

## Task 2: Server — download route in index.js

**Files:**
- Modify: `server/src/index.js`

- [ ] **Stap 1: Voeg de download route toe in `server/src/index.js`**

Voeg toe na de `/api/files/rename` route (rond regel 270), vóór de git endpoints:

```js
app.get('/api/files/download', authMiddleware, (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' });
  const result = files.downloadFile(req.query.path);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.set({
    'Content-Type': result.mimeType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(result.name)}"`,
    'Content-Length': result.size,
  });
  res.send(result.buffer);
});
```

- [ ] **Stap 2: Test de route handmatig**

Start de server:
```bash
cd server && npm start
```

Test met curl (vervang token en pad):
```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3443/api/files/download?path=C:\\Users\\ravir\\test.txt" -o test-download.txt
```
Verwacht: bestand gedownload zonder error.

Test 50MB limiet:
```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3443/api/files/download?path=C:\\pad\\naar\\groot-bestand.zip" -v
```
Verwacht: HTTP 413 als bestand > 50MB.

- [ ] **Stap 3: Commit**

```bash
rtk git add server/src/index.js
rtk git commit -m "feat: add GET /api/files/download endpoint"
```

---

## Task 3: Mobile — packages installeren

**Files:**
- Modify: `mobile/package.json` (via npx expo install)

- [ ] **Stap 1: Installeer de benodigde Expo packages**

```bash
cd mobile
npx expo install expo-file-system expo-media-library expo-sharing
```

Verwacht: packages toegevoegd aan `package.json` en `node_modules`.

- [ ] **Stap 2: Commit**

```bash
rtk git add mobile/package.json
rtk git commit -m "feat: install expo-file-system, expo-media-library, expo-sharing"
```

---

## Task 4: Mobile — `downloadFile` utility

**Files:**
- Create: `mobile/utils/downloadFile.ts`

- [ ] **Stap 1: Maak `mobile/utils/downloadFile.ts`**

```typescript
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv',
  '.jpg', '.jpeg', '.png', '.gif', '.heic', '.webp',
  '.mp3', '.wav', '.aac',
]);

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export async function downloadFile(
  serverUrl: string,
  token: string,
  filePath: string,
  fileName: string,
): Promise<{ ok: true; target: 'camera' | 'share' } | { ok: false; error: string }> {
  const url = `${serverUrl}/api/files/download?path=${encodeURIComponent(filePath)}`;
  const localUri = FileSystem.cacheDirectory + fileName;

  let downloadResult: FileSystem.FileSystemDownloadResult;
  try {
    downloadResult = await FileSystem.downloadAsync(url, localUri, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    return { ok: false, error: e.message || 'Netwerkfout' };
  }

  if (downloadResult.status === 413) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Bestand te groot (>50MB)' };
  }
  if (downloadResult.status === 404) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Bestand niet gevonden' };
  }
  if (downloadResult.status !== 200) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: `Serverfout (${downloadResult.status})` };
  }

  const ext = getExtension(fileName);
  const isMedia = MEDIA_EXTENSIONS.has(ext);

  if (isMedia) {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      try {
        await MediaLibrary.saveToLibraryAsync(localUri);
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        return { ok: true, target: 'camera' };
      } catch (e: any) {
        // fallthrough to share sheet
      }
    }
  }

  // Share sheet (also fallback when MediaLibrary permission denied)
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Delen niet beschikbaar op dit apparaat' };
  }
  await Sharing.shareAsync(localUri, { UTI: 'public.item' });
  await FileSystem.deleteAsync(localUri, { idempotent: true });
  return { ok: true, target: 'share' };
}
```

- [ ] **Stap 2: Type-check**

```bash
cd mobile && npx tsc --noEmit
```

Verwacht: geen errors.

- [ ] **Stap 3: Commit**

```bash
rtk git add mobile/utils/downloadFile.ts
rtk git commit -m "feat: add downloadFile utility with Camera Roll and share sheet support"
```

---

## Task 5: Mobile — UI in editor.tsx

**Files:**
- Modify: `mobile/app/(tabs)/editor.tsx`

- [ ] **Stap 1: Voeg imports toe bovenaan `editor.tsx`**

Voeg toe na de bestaande imports (na regel ~20):

```typescript
import { downloadFile } from '../../utils/downloadFile';
import { useStore } from '../../store';
```

Opmerking: `useStore` is al geïmporteerd. Voeg ook `serverUrl` en `token` toe aan de destructuring van `useStore()`:

```typescript
const {
  accentColor,
  serverUrl,
  token,
  editorProjectPath: storedProjectPath,
  // ... rest ongewijzigd
} = useStore();
```

- [ ] **Stap 2: Voeg download state en handler toe**

Voeg toe na de bestaande state declaraties (bijv. na regel ~82, na `showRename`):

```typescript
const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
```

Voeg de handler toe na `handleDeleteItem` (na regel ~280):

```typescript
const handleDownload = async (item: FileItem) => {
  if (!serverUrl || !token) return;
  setDownloadingPath(item.path);
  try {
    const result = await downloadFile(serverUrl, token, item.path, item.name);
    if (!result.ok) {
      showAlert('Fout', result.error);
    } else if (result.target === 'camera') {
      showAlert('Opgeslagen', 'Bestand opgeslagen in Camera Roll');
    }
    // share sheet: geen alert nodig, share sheet is de bevestiging
  } finally {
    setDownloadingPath(null);
  }
};
```

- [ ] **Stap 3: Voeg "Downloaden" toe aan het context menu**

Zoek het context menu modal in `editor.tsx` (rond regel 463). Voeg een nieuwe `TouchableOpacity` toe vóór "Hernoemen", maar alleen voor bestanden (niet mappen):

```typescript
{!contextItem?.isDirectory && (
  <TouchableOpacity
    style={styles.contextOption}
    onPress={() => {
      const item = contextItem!;
      setContextItem(null);
      handleDownload(item);
    }}
  >
    {downloadingPath === contextItem?.path ? (
      <ActivityIndicator size="small" color="#4ade80" style={{ marginRight: 12, width: 18 }} />
    ) : (
      <Ionicons name="download" size={18} color="#4ade80" style={{ marginRight: 12 }} />
    )}
    <Text style={styles.contextOptionText}>Downloaden</Text>
  </TouchableOpacity>
)}
```

- [ ] **Stap 4: Type-check**

```bash
cd mobile && npx tsc --noEmit
```

Verwacht: geen errors.

- [ ] **Stap 5: Commit**

```bash
rtk git add mobile/app/(tabs)/editor.tsx
rtk git commit -m "feat: add download option to file context menu"
```

---

## Task 6: Handmatig testen op apparaat

- [ ] **Stap 1: Start server en open app**

```bash
cd server && npm start
cd mobile && npx expo start
```

- [ ] **Stap 2: Test tekstbestand downloaden**
  - Open Editor tab → navigeer naar een `.txt` of `.js` bestand
  - Tik 3-dots → "Downloaden"
  - Verwacht: share sheet verschijnt, sla op in Files app

- [ ] **Stap 3: Test videobestand downloaden**
  - Navigeer naar een `.mp4` bestand
  - Tik 3-dots → "Downloaden"
  - Verwacht: permissie gevraagd (eerste keer), dan opgeslagen in Camera Roll, alert "Opgeslagen in Camera Roll"

- [ ] **Stap 4: Test afbeelding downloaden**
  - Navigeer naar een `.jpg` bestand
  - Tik 3-dots → "Downloaden"
  - Verwacht: opgeslagen in Camera Roll

- [ ] **Stap 5: Test map heeft geen download optie**
  - Tik 3-dots op een map
  - Verwacht: alleen Hernoemen en Verwijderen, geen Downloaden

- [ ] **Stap 6: Final commit**

```bash
rtk git add -A
rtk git commit -m "feat: file download to device — Camera Roll and Files app"
```
