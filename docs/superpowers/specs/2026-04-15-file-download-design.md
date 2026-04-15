# File Download — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Overview

Gebruikers kunnen bestanden van de server downloaden naar hun iPhone — naar Camera Roll (foto's/video's) of via de share sheet naar de Files app. Toegankelijk via het 3-dots context menu in de FileTree.

## Server

### Nieuw endpoint

```
GET /api/files/download?path=<absoluut pad>
Authorization: Bearer <jwt>
```

- Geïmplementeerd in `server/src/files.js` als `downloadFile(filePath)` functie
- Route in `server/src/index.js` met auth middleware
- Leest bestand als binary buffer
- Stuurt terug met:
  - `Content-Disposition: attachment; filename="<bestandsnaam>"`
  - `Content-Type` op basis van extensie (mime-type lookup)
  - `Content-Length` header
- **Limiet:** 50MB — geeft HTTP 413 terug als bestand groter is
- Geen extensiefilter — alles mag (ook .exe, .mp4, .zip)

### MIME-type mapping

Uitbreiding van bestaande extensie-map in `files.js` met veelgebruikte types: video (mp4, mov, avi), audio (mp3, wav), archief (zip, tar, gz), image (jpg, png, gif, heic), en fallback `application/octet-stream`.

## Mobile

### Packages

- `expo-file-system` — download naar tijdelijk cachepad
- `expo-media-library` — opslaan in Camera Roll (foto/video)
- `expo-sharing` — share sheet voor overige bestanden

### Downloadlogica (`mobile/utils/downloadFile.ts`)

Nieuwe utility functie `downloadFile(filePath, fileName, apiFetch)`:

1. Bouw download-URL: `${serverUrl}/api/files/download?path=<encoded>`
2. `FileSystem.downloadAsync(url, cacheUri, { headers: { Authorization } })`
3. Check extensie:
   - Foto/video (`.mp4`, `.mov`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.heic`, `.avi`, `.mp3`, `.wav`): `MediaLibrary.saveToLibraryAsync(localUri)`
   - Overige: `Sharing.shareAsync(localUri)`
4. Verwijder tijdelijk bestand na afloop
5. Geeft `{ ok: true, target: 'camera' | 'share' }` of `{ ok: false, error }` terug

### Permissies

`expo-media-library` vereist `MEDIA_LIBRARY` permissie. Vraag aan bij eerste gebruik via `MediaLibrary.requestPermissionsAsync()`. Bij weigering: fallback naar share sheet.

### UI — FileTree context menu

- Nieuwe optie **"Downloaden"** in het 3-dots menu (naast Rename/Delete)
- Tijdens download: spinner op de betreffende bestandsrij (`downloadingPath` state)
- Succes: `showAlert('Opgeslagen', 'Bestand opgeslagen in Camera Roll')` of geen alert bij share sheet (share sheet is zelf de bevestiging)
- Fout: `showAlert('Fout', error.message)`

### Geen wijzigingen aan

- `store/index.ts` — geen nieuwe state nodig
- `useApi.ts` — download gebruikt directe fetch met auth header via `FileSystem`
- Bestaande editor/file-read flow

## Foutgevallen

| Situatie | Gedrag |
|---|---|
| Bestand > 50MB | Server geeft 413, app toont alert |
| Bestand niet gevonden | Server geeft 404, app toont alert |
| Permissie geweigerd (MediaLibrary) | Fallback naar share sheet |
| Netwerk weggevallen | `FileSystem.downloadAsync` gooit error, app toont alert |
