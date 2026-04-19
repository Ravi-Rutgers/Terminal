# Session Persistence — Design Spec

**Date:** 2026-04-19
**Status:** Approved

## Probleem

Sessies gaan op twee manieren verloren:
1. **Server herstart** — sessies leven alleen in `sessions = new Map()` in geheugen
2. **App achtergrond** — Zustand wordt gereset of sessies worden niet opnieuw opgehaald bij terugkomen

## Oplossing

### Server side — JSON-persistentie

**Bestand:** `server/sessions.json` (in `.gitignore`)

Bij elke sessiewijziging (aanmaken, verwijderen) schrijft `terminal.js` de huidige sessielijst naar `server/sessions.json`:

```json
[
  { "id": "uuid", "title": "Session 1", "workdir": "C:\\Users\\ravir\\project" }
]
```

Bij opstarten van de server (`index.js` of `terminal.js` init) wordt `sessions.json` gelezen en voor elke opgeslagen sessie automatisch een nieuwe pty gestart in dezelfde `workdir`. Logs worden **niet** opgeslagen — te groot, niet zinvol na herstart. Elke herstelde sessie begint met een schone terminal in de juiste map.

**Persistentiemomenten:**
- Na `createSession()` → bestand bijwerken
- Na `killSession()` → bestand bijwerken
- Bij `ptyProcess.onExit` → bestand bijwerken (sessie verwijderen)

**Gitignore:** `server/sessions.json` toegevoegd aan `.gitignore`

### Mobile side — AppState refetch

In `mobile/app/_layout.tsx`, in de `AuthRedirect` component (of een nieuwe `SessionRefresher` component), een `AppState` listener toevoegen:

```typescript
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active') {
    // refetch sessions via /api/sessions
  }
});
```

Sessies worden opgehaald via de bestaande `/api/sessions` endpoint en in de Zustand store gezet (`setSessions`). Geen wijzigingen aan terminal WebSocket of replay-logica.

## Geen wijzigingen aan

- Terminal WebSocket protocol
- Session replay bij subscribe
- Store structuur
- Auth flow

## Foutgevallen

| Situatie | Gedrag |
|---|---|
| `sessions.json` beschadigd of onleesbaar | Server logt waarschuwing, start zonder herstelde sessies |
| `workdir` bestaat niet meer bij herstart | Session wordt aangemaakt, pty start in fallback home dir |
| AppState refetch mislukt (server offline) | Stille fout, bestaande store-state blijft |
