import { getItem, setItem } from './storage';

const KEY = 'hussle_recent_urls';
const MAX = 5;

export async function getRecentUrls(): Promise<string[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function addRecentUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  const existing = await getRecentUrls();
  const filtered = existing.filter((u) => u !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX);
  await setItem(KEY, JSON.stringify(updated));
}
