import { useCallback } from 'react';
import { getItem, setItem, deleteItem } from '../utils/storage';
import { useStore } from '../store';

const TOKEN_KEY = 'hussle_jwt';
const URL_KEY = 'hussle_server_url';
const CLAUDE_SESSION_KEY = 'hussle_claude_session_key';

export function useAuth() {
  const { serverUrl, token, setToken, setServerUrl, setClaudeSessionKey, setClaudeOrgId } = useStore();

  const loadStored = useCallback(async () => {
    const [storedToken, storedUrl, storedClaudeKey, storedOrgId] = await Promise.all([
      getItem(TOKEN_KEY),
      getItem(URL_KEY),
      getItem(CLAUDE_SESSION_KEY),
      getItem('hussle_claude_org_id'),
    ]);
    if (storedToken) setToken(storedToken);
    if (storedUrl) setServerUrl(storedUrl);
    if (storedClaudeKey) setClaudeSessionKey(storedClaudeKey);
    if (storedOrgId) setClaudeOrgId(storedOrgId);
    return { token: storedToken, url: storedUrl };
  }, [setToken, setServerUrl, setClaudeSessionKey, setClaudeOrgId]);

  const login = useCallback(
    async (url: string, password: string) => {
      let cleanUrl = url.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(cleanUrl)) {
        cleanUrl = `http://${cleanUrl}`;
      }
      const res = await fetch(`${cleanUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Login failed');
      }

      const { token: jwt } = await res.json();
      await Promise.all([
        setItem(TOKEN_KEY, jwt),
        setItem(URL_KEY, cleanUrl),
      ]);
      setToken(jwt);
      setServerUrl(cleanUrl);
      return jwt;
    },
    [setToken, setServerUrl],
  );

  const logout = useCallback(async () => {
    await Promise.all([
      deleteItem(TOKEN_KEY),
      deleteItem(URL_KEY),
      deleteItem(CLAUDE_SESSION_KEY),
      deleteItem('hussle_claude_org_id'),
    ]);
    setToken(null);
    setClaudeSessionKey(null);
  }, [setToken, setClaudeSessionKey]);

  return { serverUrl, token, loadStored, login, logout, isAuthenticated: !!token };
}
