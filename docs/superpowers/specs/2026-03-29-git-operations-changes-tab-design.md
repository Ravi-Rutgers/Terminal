# Git Operations in Changes Tab — Design Spec

## Context

The Hussle Terminal Changes tab currently only displays git status and diffs (read-only). Users need to switch to the Terminal tab or use the GitHub tab for any git actions. This design adds full git workflow capabilities directly in the Changes tab, making it a complete git management interface.

## Architecture

**Hybrid approach:**
- Most git operations (stage, commit, branch, stash, tag, fetch) use REST endpoints via `execFile`
- Interactive operations (push, pull, merge) use a mini-terminal (PTY session) to handle credential prompts and conflict resolution

## Server Endpoints

All endpoints require auth middleware. All POST/DELETE endpoints accept `path` (project directory) in the request body or query.

### Staging
| Method | Path | Body/Query | Git Command |
|--------|------|------------|-------------|
| POST | `/api/git/add` | `{ path, files: string[] }` | `git add <files>` |
| POST | `/api/git/unstage` | `{ path, files: string[] }` | `git reset HEAD <files>` |
| POST | `/api/git/add-all` | `{ path }` | `git add -A` |

### Commit
| Method | Path | Body | Git Command |
|--------|------|------|-------------|
| POST | `/api/git/commit` | `{ path, message, amend?: boolean }` | `git commit -m "msg"` or `git commit --amend -m "msg"` |

### Sync (REST)
| Method | Path | Body | Git Command |
|--------|------|------|-------------|
| POST | `/api/git/fetch` | `{ path }` | `git fetch --all` |

### Sync (Mini-Terminal)
Push, pull, and merge run in a dedicated PTY session (mini-terminal) because they may require credential prompts or interactive conflict resolution.
- **Push**: `git push` (with optional `--force`)
- **Pull**: `git pull`
- **Merge**: `git merge <branch>`

### Branches
| Method | Path | Body/Query | Git Command |
|--------|------|------------|-------------|
| GET | `/api/git/branches` | `?path=` | `git branch -a --format="%(refname:short)\|\|%(objectname:short)\|\|%(upstream:short)\|\|%(HEAD)"` |
| POST | `/api/git/checkout` | `{ path, branch }` | `git checkout <branch>` |
| POST | `/api/git/branch/create` | `{ path, name, base? }` | `git checkout -b <name> [base]` |
| DELETE | `/api/git/branch` | `?path=&name=` | `git branch -d <name>` |

### Stash
| Method | Path | Body/Query | Git Command |
|--------|------|------------|-------------|
| GET | `/api/git/stash/list` | `?path=` | `git stash list` |
| POST | `/api/git/stash` | `{ path, message? }` | `git stash [push -m "msg"]` |
| POST | `/api/git/stash/pop` | `{ path, index? }` | `git stash pop [index]` |
| DELETE | `/api/git/stash` | `?path=&index=` | `git stash drop [index]` |

### Tags
| Method | Path | Body/Query | Git Command |
|--------|------|------------|-------------|
| GET | `/api/git/tags` | `?path=` | `git tag -l --format="%(refname:short)\|\|%(objectname:short)\|\|%(creatordate:relative)\|\|%(subject)"` |
| POST | `/api/git/tag` | `{ path, name, message? }` | `git tag [-a -m "msg"] <name>` |
| DELETE | `/api/git/tag` | `?path=&name=` | `git tag -d <name>` |

## Mini-Terminal Component (`GitTerminal`)

Based on the existing `EditorTerminal` pattern:
- Collapsible panel at the bottom of the Changes tab
- Own PTY session via WebSocket (reuses `useWebSocket` hook)
- Shows output of push/pull/merge operations
- Supports manual git command input
- Toggle button to open/close
- Auto-opens when push/pull/merge is triggered
- Auto-creates a session with `cwd` set to the project path

## Changes Tab UI Layout

Top to bottom:

### 1. Header Bar
- **Left**: Branch name chip (tap → branch selector modal)
- **Right**: Fetch, Pull, Push icon buttons
- Branch chip shows current branch with accent color

### 2. Last Commit Card (existing, unchanged)
- Commit message, author, hash, relative time

### 3. Summary Bar (enhanced)
- Total changes count with color-coded badges
- "Stage All" / "Unstage All" buttons added

### 4. File List (enhanced)
- Each file row gets a checkbox/toggle for stage/unstage
- Tap checkbox → stage or unstage that file
- Tap file name → expand diff (existing behavior)
- Files grouped by status type (existing behavior)
- Staged files visually distinguished (accent border or checkmark)

### 5. Commit Input Area (new)
- `TextInput` for commit message (multiline, placeholder "Commit bericht...")
- Row: [Commit button] [Amend toggle]
- Commit button disabled when message is empty or no staged files
- After successful commit: clear message, refetch status

### 6. More Actions Menu (new)
- Accessible via a "..." or gear icon button in the header
- Sections:
  - **Stash**: Stash wijzigingen, Pop, Lijst bekijken
  - **Merge**: Branch selector → merge
  - **Tags**: Lijst, Nieuwe tag, Verwijderen
- Each section opens as a modal/bottom sheet

### 7. Mini-Terminal Panel (new)
- Collapsible at bottom (FAB toggle button, same pattern as EditorTerminal)
- xterm.js WebView with own PTY session
- Shows push/pull/merge output
- Resizable with snap points

## Branch Selector Modal
- Triggered by tapping branch chip in header
- Lists all local + remote branches
- Search/filter input at top
- "Nieuwe branch" button → name input + base branch picker
- Active branch highlighted with accent color
- Tap branch → checkout (with confirmation if uncommitted changes)

## Stash Modal
- List of stashes with index, message, relative time
- "Stash wijzigingen" button (optional message input)
- Per stash: Pop button, Drop button (with confirmation)

## Tags Modal
- List of tags with name, hash, date, message
- "Nieuwe tag" button → name input + optional message
- Per tag: Delete button (with confirmation)

## Merge Flow
- Branch selector modal (same component as branch selector, filtered to exclude current)
- Tap branch → confirm merge
- Output shown in mini-terminal
- After merge: refetch status + branches

## Error Handling
- REST endpoint errors: show alert with error message
- Mini-terminal errors: visible in terminal output
- Network errors: existing error handling from `useApi` hook
- Checkout with uncommitted changes: warn user first (check via status)

## Files to Modify

### Server
- `server/src/index.js` — Add all new git REST endpoints

### Mobile
- `mobile/app/(tabs)/changes.tsx` — Major rewrite: add staging controls, commit input, header bar, more menu, mini-terminal integration
- `mobile/components/GitTerminal.tsx` — New component (based on EditorTerminal)
- `mobile/components/BranchSelector.tsx` — New component for branch picker modal
- `mobile/components/GitActionsMenu.tsx` — New component for stash/merge/tags menu

## Verification

1. **Staging**: Tap checkbox on untracked/modified file → verify `git status` shows it as staged → unstage → verify
2. **Commit**: Stage files, type message, tap commit → verify new commit in log, files cleared from status
3. **Push**: Tap push → mini-terminal opens, shows push output → verify remote updated
4. **Pull**: Tap pull → mini-terminal shows pull output → verify local updated
5. **Branch**: Tap branch chip → switch branch → verify UI updates, files change
6. **Create branch**: New branch from selector → verify branch created and checked out
7. **Stash**: Stash changes → verify working tree clean → pop → verify changes restored
8. **Merge**: Select branch → merge → verify commit log updated
9. **Tags**: Create tag → verify in list → delete → verify removed
10. **Amend**: Toggle amend, edit message, commit → verify last commit updated

## UI Language
All user-facing text in Dutch, consistent with the rest of the app.
