# Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessies overleven server herstarts (via JSON-bestand) en verdwijnen niet meer uit de app na achtergrond (via AppState refetch).

**Architecture:** Server schrijft sessielijst naar `server/sessions.json` bij elke wijziging; bij opstarten herstelt hij sessies automatisch. Mobile-side luistert naar AppState 'active' en herlaadt sessies via `/api/sessions`.

**Tech Stack:** Node.js/CommonJS (server), React Native + Expo SDK 54, AppState API, Zustand

---

## File Map

| Actie | Bestand | Verantwoordelijkheid |
|---|---|---|
| Modify | `server/src/terminal.js` | Persistentie: schrijf/lees `sessions.json`, herstel sessies bij init |
| Modify | `.gitignore` | Voeg `server/sessions.json` toe |
| Modify | `mobile/app/_layout.tsx` | AppState listener die sessies herlaadt bij app-focus |

---

## Task 1: .gitignore — sessions.json uitsluiten

**Files:**
- Modify: `.gitignore`

- [ ] **Stap 1: Voeg `server/sessions.json` toe aan `.gitignore`**

Open `.gitignore` in de root van het project en voeg toe aan het einde:

```
# Session persistence
server/sessions.json
```

- [ ] **Stap 2: Commit**

```bash
cd C:/Users/ravir/Documents/Hussle/terminal && rtk git add .gitignore && rtk git commit -m "chore: ignore server/sessions.json"
```

---

## Task 2: Server — sessie-persistentie in terminal.js

**Files:**
- Modify: `server/src/terminal.js`

Dit is de kern van de feature. Drie dingen toevoegen:
1. `saveSessions()` — schrijft huidige sessielijst naar `sessions.json`
2. `restoreSessions()` — leest `sessions.json` bij opstarten en herstart pty's
3. Aanroepen van `saveSessions()` na create, kill, en pty exit

- [ ] **Stap 1: Voeg `fs`, `path` en persistentiefuncties toe aan `server/src/terminal.js`**

Voeg bovenaan het bestand toe, na de bestaande requires:

```js
const fs = require('fs');
const path = require('path');

const SESSIONS_FILE = path.join(__dirname, '../../sessions.json');

function saveSessions() {
  try {
    const data = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      title: s.title,
      workdir: s.workdir,
    }));
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[terminal] Could not save sessions:', e.message);
  }
}

function restoreSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (e) {
    console.warn('[terminal] Could not read sessions.json, starting fresh:', e.message);
    return;
  }
  for (const s of saved) {
    try {
      createSession(s.workdir, s.id, s.title);
    } catch (e) {
      console.warn('[terminal] Could not restore session', s.id, ':', e.message);
    }
  }
  console.log(`[terminal] Restored ${saved.length} session(s) from disk`);
}
```

- [ ] **Stap 2: Pas `createSession` aan om optioneel een bestaand id en titel te accepteren**

Vervang de huidige `createSession(workdir)` signatuur door:

```js
function createSession(workdir, existingId, existingTitle) {
  const id = existingId || crypto.randomUUID();
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const cwd = workdir || process.env.USERPROFILE || process.env.HOME;

  // Verify workdir exists, fall back to home if not
  const resolvedCwd = (cwd && fs.existsSync(cwd)) ? cwd : (process.env.USERPROFILE || process.env.HOME);

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: resolvedCwd,
    env: process.env,
  });

  const session = {
    id,
    pty: ptyProcess,
    logs: [],
    workdir: resolvedCwd,
    title: existingTitle || `Session ${++sessionCounter}`,
    active: true,
    subscribers: new Set(),
    createdAt: new Date().toISOString(),
  };

  ptyProcess.onData((data) => {
    session.logs.push(data);
    if (session.logs.length > MAX_LOG_LINES) {
      session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
    }
    for (const ws of session.subscribers) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal/output', sessionId: id, data }));
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.active = false;
    for (const ws of session.subscribers) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'session/ended', sessionId: id, exitCode }));
      }
    }
    saveSessions();
  });

  sessions.set(id, session);
  saveSessions();
  return { id, title: session.title, workdir: session.workdir, active: true };
}
```

- [ ] **Stap 3: Pas `killSession` aan om `saveSessions()` aan te roepen**

Vervang de huidige `killSession`:

```js
function killSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.active = false;
  sessions.delete(sessionId);
  try {
    session.pty.kill();
  } catch (e) {
    // pty may already be dead
  }
  saveSessions();
  return true;
}
```

- [ ] **Stap 4: Exporteer `restoreSessions` en voeg toe aan `module.exports`**

Vervang het huidige `module.exports` blok:

```js
module.exports = {
  createSession,
  writeToSession,
  resizeSession,
  killSession,
  subscribe,
  unsubscribeAll,
  listSessions,
  getSessionLogs,
  restoreSessions,
};
```

- [ ] **Stap 5: Commit**

```bash
cd C:/Users/ravir/Documents/Hussle/terminal && rtk git add server/src/terminal.js && rtk git commit -m "feat: add session persistence to terminal.js"
```

---

## Task 3: Server — roep `restoreSessions()` aan bij opstarten

**Files:**
- Modify: `server/src/index.js`

- [ ] **Stap 1: Roep `restoreSessions()` aan na de require van terminal**

Zoek in `server/src/index.js` de regel:

```js
const terminal = require('./terminal');
```

Voeg direct daarna toe:

```js
terminal.restoreSessions();
```

- [ ] **Stap 2: Commit**

```bash
cd C:/Users/ravir/Documents/Hussle/terminal && rtk git add server/src/index.js && rtk git commit -m "feat: restore sessions on server startup"
```

---

## Task 4: Mobile — AppState refetch bij app-focus

**Files:**
- Modify: `mobile/app/_layout.tsx`

- [ ] **Stap 1: Voeg imports toe aan `mobile/app/_layout.tsx`**

Voeg toe aan de bestaande imports bovenaan:

```typescript
import { AppState, AppStateStatus } from 'react-native';
import { useApi } from '../hooks/useApi';
```

- [ ] **Stap 2: Voeg `SessionRefresher` component toe**

Voeg toe na de `AuthRedirect` component definitie (voor `export default function RootLayout`):

```typescript
function SessionRefresher() {
  const { apiFetch } = useApi();
  const { token, setSessions } = useStore();

  useEffect(() => {
    if (!token) return;

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        try {
          const data = await apiFetch('/api/sessions');
          if (Array.isArray(data)) {
            setSessions(data);
          }
        } catch {
          // stille fout — bestaande store-state blijft
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [token, apiFetch, setSessions]);

  return null;
}
```

- [ ] **Stap 3: Voeg `<SessionRefresher />` toe in `RootLayout`**

Zoek in `RootLayout` de return, voeg `<SessionRefresher />` toe naast `<AuthRedirect />`:

```typescript
return (
  <QueryClientProvider client={queryClient}>
    <AuthRedirect />
    <SessionRefresher />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#e0e0e0',
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="editor/[path]" options={{ headerShown: true, title: 'Editor' }} />
      <Stack.Screen name="agent-history/[id]" options={{ headerShown: true, title: 'Geschiedenis', animation: 'slide_from_right' }} />
    </Stack>
    {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
  </QueryClientProvider>
);
```

- [ ] **Stap 4: Voeg `setSessions` toe aan useStore destructuring in `RootLayout`**

`RootLayout` gebruikt al `useStore`. Zorg dat `setSessions` beschikbaar is in `SessionRefresher` via de store (dit werkt al automatisch via `useStore()`).

- [ ] **Stap 5: Type-check**

```bash
cd C:/Users/ravir/Documents/Hussle/terminal/mobile && npx tsc --noEmit 2>&1 | head -30
```

Verwacht: geen errors in `_layout.tsx`.

- [ ] **Stap 6: Commit**

```bash
cd C:/Users/ravir/Documents/Hussle/terminal && rtk git add mobile/app/_layout.tsx && rtk git commit -m "feat: refetch sessions when app returns to foreground"
```
