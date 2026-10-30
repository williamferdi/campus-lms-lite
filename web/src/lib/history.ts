import { useSyncExternalStore } from "react";

/**
 * Recently viewed pages, kept only in this browser's localStorage. There is no server-side
 * page-view history, so the History tray labels this list as "on this device".
 */
export interface HistoryEntry {
  path: string;
  title: string;
  context: string | null;
  visitedAt: string;
}

const KEY = "lms.history.v1";
const MAX = 30;
const MAX_AGE_MS = 21 * 86400_000;
const listeners = new Set<() => void>();
let cache: HistoryEntry[] | null = null;

function read(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as HistoryEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    cache = Array.isArray(raw) ? raw.filter((e) => e && typeof e.path === "string" && Date.parse(e.visitedAt) > cutoff) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries: HistoryEntry[]) {
  cache = entries;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked (private mode); keep the in-memory list for this tab.
  }
  listeners.forEach((l) => l());
}

export function recordVisit(entry: Omit<HistoryEntry, "visitedAt">) {
  const rest = read().filter((e) => e.path !== entry.path);
  write([{ ...entry, visitedAt: new Date().toISOString() }, ...rest].slice(0, MAX));
}

export const clearHistory = () => write([]);

export function useHistoryEntries(): HistoryEntry[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    read,
    read,
  );
}
