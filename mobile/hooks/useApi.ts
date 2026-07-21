import { useCallback } from 'react';
import { useStore } from '../store';
import { deleteItem } from '../utils/storage';
import { router } from 'expo-router';

export function useApi() {
  const { serverUrl, token, setToken, setServerUrl, setClaudeSessionKey } = useStore();

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!serverUrl || !token) {
        throw new Error('Not connected');
      }
      const url = `${serverUrl}${path}`;
      console.log(`[API] ${options?.method || 'GET'} ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options?.headers || {}),
        },
      });

      clearTimeout(timeoutId);

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (res.status === 401) {
        console.log('[API] Token expired, logging out');
        await Promise.all([deleteItem('hussle_jwt'), deleteItem('hussle_server_url')]);
        setToken(null);
        setServerUrl('');
        setClaudeSessionKey(null);
        router.replace('/login');
        throw new Error('Sessie verlopen, log opnieuw in');
      }

      if (!res.ok) {
        console.log(`[API] Error ${res.status}:`, data);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      console.log(`[API] OK:`, typeof data === 'object' ? JSON.stringify(data).slice(0, 100) : data);
      return data;
    },
    [serverUrl, token, setToken, setServerUrl, setClaudeSessionKey],
  );

  return { apiFetch };
}
