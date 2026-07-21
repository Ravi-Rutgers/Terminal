# Claude Usage Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude.ai Plan usage limits (current 5-hour session % and weekly %) in the Usage tab.

**Architecture:** Store the user's Claude.ai `sessionKey` cookie in SecureStore (same pattern as `githubToken`). Fetch usage data directly from the React Native app (no CORS in RN) from `https://claude.ai/api/usage_policy`. Display two `UsageBar` rows in a new "Claude Limieten" section in `usage.tsx`.

**Tech Stack:** React Native, Expo SecureStore, TanStack Query, Zustand, existing `UsageBar` / `StatCard` components.

---

### Task 1: Discover the Claude.ai usage API endpoint

**Files:**
- No code changes — just research

- [ ] **Step 1: Find the endpoint**

Open Claude.ai in Chrome, go to Settings → Usage limits. Open DevTools → Network tab → filter by `Fetch/XHR`. Reload the page and find the request that returns the usage percentage data (look for `usage`, `limits`, or `plan`).

Note the exact URL (e.g. `https://claude.ai/api/usage_policy` or similar) and the response JSON shape. You need:
- The field for current-session percent used
- The field for current-session reset time (seconds or ISO string)
- The field for weekly percent used
- The field for weekly reset time

Write these down — you'll use them in Task 3.

---

### Task 2: Add `claudeSessionKey` to store + SecureStore

**Files:**
- Modify: `mobile/store/index.ts`
- Modify: `mobile/hooks/useAuth.ts` (load/clear key on login/logout)

- [ ] **Step 1: Add state to store**

In `mobile/store/index.ts`, add to the `AppState` interface:
```ts
claudeSessionKey: string | null;
setClaudeSessionKey: (key: string | null) => void;
```

Add to the `create<AppState>` initial state:
```ts
claudeSessionKey: null,
```

Add the setter:
```ts
setClaudeSessionKey: (key) => set({ claudeSessionKey: key }),
```

- [ ] **Step 2: Persist to SecureStore**

At the top of `mobile/hooks/useAuth.ts`, add the key constant near the other storage keys:
```ts
const CLAUDE_SESSION_KEY = 'hussle_claude_session_key';
```

In the `login` function (or wherever `githubToken` is loaded from SecureStore on startup), also load `claudeSessionKey`:
```ts
const claudeKey = await SecureStore.getItemAsync(CLAUDE_SESSION_KEY);
if (claudeKey) useStore.getState().setClaudeSessionKey(claudeKey);
```

In the `logout` function, also clear it:
```ts
await SecureStore.deleteItemAsync(CLAUDE_SESSION_KEY);
useStore.getState().setClaudeSessionKey(null);
```

- [ ] **Step 3: Commit**
```bash
rtk git add mobile/store/index.ts mobile/hooks/useAuth.ts
rtk git commit -m "feat: add claudeSessionKey to store and SecureStore"
```

---

### Task 3: Add session key input in Settings

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Add storage constant and state**

Near the top of `settings.tsx`, add:
```ts
const CLAUDE_SESSION_KEY = 'hussle_claude_session_key';
```

Inside the component, add state for the input:
```ts
const { claudeSessionKey, setClaudeSessionKey } = useStore();
const [claudeKeyInput, setClaudeKeyInput] = useState(claudeSessionKey || '');
```

- [ ] **Step 2: Add save handler**

Add a save function in the component:
```ts
const saveClaudeKey = async () => {
  const trimmed = claudeKeyInput.trim();
  if (trimmed) {
    await setItem(CLAUDE_SESSION_KEY, trimmed);
    setClaudeSessionKey(trimmed);
  } else {
    await deleteItem(CLAUDE_SESSION_KEY);
    setClaudeSessionKey(null);
  }
  showAlert('Opgeslagen', 'Claude sessie sleutel opgeslagen.');
};
```

Note: `setItem`/`deleteItem` are already imported from `../../utils/storage` in this file.

- [ ] **Step 3: Render the input section**

Find where the GitHub token section is rendered and add a similar section below it. Look for the GitHub token block pattern and add after it:

```tsx
{/* Claude Session Key */}
<Text style={styles.sectionTitle}>Claude Sessie Sleutel</Text>
<View style={styles.tokenSection}>
  <Text style={styles.tokenLabel}>
    Plak je sessionKey cookie van claude.ai (DevTools → Application → Cookies)
  </Text>
  <View style={styles.tokenRow}>
    <TextInput
      style={[styles.tokenInput, { flex: 1 }]}
      value={claudeKeyInput}
      onChangeText={setClaudeKeyInput}
      placeholder="sk-ant-..."
      placeholderTextColor="#444"
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
    />
    <TouchableOpacity style={styles.tokenSaveBtn} onPress={saveClaudeKey}>
      <Text style={styles.tokenSaveTxt}>Opslaan</Text>
    </TouchableOpacity>
  </View>
  {claudeSessionKey && (
    <Text style={styles.tokenStatus}>
      ✓ Sleutel opgeslagen
    </Text>
  )}
</View>
```

Use the same style names already used by the GitHub token section (`tokenSection`, `tokenLabel`, `tokenRow`, `tokenInput`, `tokenSaveBtn`, `tokenSaveTxt`). Add `tokenStatus` style if it doesn't exist:
```ts
tokenStatus: {
  color: '#4ade80',
  fontSize: 11,
  marginTop: 4,
},
```

- [ ] **Step 4: Commit**
```bash
rtk git add mobile/app/(tabs)/settings.tsx
rtk git commit -m "feat: add Claude session key input in settings"
```

---

### Task 4: Fetch usage data and display in Usage tab

**Files:**
- Modify: `mobile/app/(tabs)/usage.tsx`

- [ ] **Step 1: Add the usage query**

At the top of `UsageScreen`, destructure `claudeSessionKey` from store:
```ts
const { sessions, setSystemInfo, claudeSessionKey } = useStore();
```

Add a TanStack Query to fetch usage (replace `ENDPOINT` with what you discovered in Task 1, e.g. `https://claude.ai/api/usage_policy`):
```ts
const { data: claudeUsage } = useQuery({
  queryKey: ['claude-usage', claudeSessionKey],
  queryFn: async () => {
    if (!claudeSessionKey) return null;
    const res = await fetch('ENDPOINT', {
      headers: {
        Cookie: `sessionKey=${claudeSessionKey}`,
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!res.ok) throw new Error('Failed to fetch usage');
    return res.json();
  },
  enabled: !!claudeSessionKey,
  refetchInterval: 60000,
  retry: false,
});
```

- [ ] **Step 2: Parse response into display values**

After the query, add parsing logic (adjust field names based on Task 1 findings):
```ts
// Adjust these field paths based on actual API response shape
const sessionPct: number = claudeUsage?.session?.percentUsed ?? claudeUsage?.current_session?.percent_used ?? 0;
const sessionResetMins: number = claudeUsage?.session?.resetInSeconds
  ? Math.round(claudeUsage.session.resetInSeconds / 60)
  : claudeUsage?.current_session?.reset_in_minutes ?? 0;
const weeklyPct: number = claudeUsage?.weekly?.percentUsed ?? claudeUsage?.weekly?.percent_used ?? 0;
const weeklyReset: string = claudeUsage?.weekly?.resetsAt ?? claudeUsage?.weekly?.resets_at ?? '';

function formatResetTime(isoOrLabel: string): string {
  if (!isoOrLabel) return '';
  try {
    const d = new Date(isoOrLabel);
    return `Reset ${d.toLocaleDateString('nl-NL', { weekday: 'short' })} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return isoOrLabel;
  }
}
```

- [ ] **Step 3: Render "Claude Limieten" section**

Add a new section in the JSX, just below the "Claude API" stat cards and above "Sessies":

```tsx
{claudeSessionKey && (
  <>
    <Text style={styles.sectionTitle}>Claude Limieten</Text>
    <View style={styles.systemCard}>
      {claudeUsage ? (
        <>
          <UsageBar
            label={`Sessie (reset over ${sessionResetMins}min)`}
            percent={sessionPct}
            color={sessionPct > 80 ? '#f87171' : '#60a5fa'}
          />
          <UsageBar
            label={`Wekelijks — ${formatResetTime(weeklyReset)}`}
            percent={weeklyPct}
            color={weeklyPct > 80 ? '#f87171' : '#4ade80'}
          />
        </>
      ) : (
        <Text style={{ color: '#666', fontSize: 12 }}>Laden...</Text>
      )}
    </View>
  </>
)}
```

`systemCard` style already exists in this file — reuse it.

- [ ] **Step 4: Commit**
```bash
rtk git add mobile/app/(tabs)/usage.tsx
rtk git commit -m "feat: show Claude usage limits in usage tab"
```

---

### Task 5: Load claudeSessionKey on app startup

**Files:**
- Modify: `mobile/hooks/useAuth.ts`

- [ ] **Step 1: Read the file and find where githubToken is loaded**

In `useAuth.ts`, find where `hussle_github_token` is loaded from SecureStore (typically in a `useEffect` or `checkAuth` function) and add the claude key load right after it:

```ts
const savedClaudeKey = await SecureStore.getItemAsync('hussle_claude_session_key');
if (savedClaudeKey) useStore.getState().setClaudeSessionKey(savedClaudeKey);
```

- [ ] **Step 2: Commit**
```bash
rtk git add mobile/hooks/useAuth.ts
rtk git commit -m "fix: load claudeSessionKey from SecureStore on startup"
```

---

## Notes

- The exact Claude.ai API endpoint and JSON field names **must** be discovered in Task 1 before implementing Task 4. The parsing in Task 4 has fallback field paths but you should confirm the correct ones.
- If the fetch fails with CORS or cookie issues from React Native, fall back to routing through the server (`/api/claude-usage`) which forwards the cookie server-side.
- `UsageBar` and `systemCard` style already exist in the file — no new components needed.
