import type { ListState } from "../../shared/types";

export interface RecentList {
  code: string;
  name: string;
  lastOpened: number;
}

const RECENT_KEY = "kkjv:recent";
const KEYS_KEY = "kkjv:editKeys";
const CACHE_PREFIX = "kkjv:cache:";
const MAX_RECENT = 20;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage plein ou indisponible : on ignore
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getRecentLists(): RecentList[] {
  const list = safeParse<RecentList[]>(safeGet(RECENT_KEY)) ?? [];
  return list.sort((a, b) => b.lastOpened - a.lastOpened);
}

export function touchRecentList(code: string, name: string): void {
  const list = getRecentLists().filter((l) => l.code !== code);
  list.unshift({ code, name, lastOpened: Date.now() });
  safeSet(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export function forgetRecentList(code: string): void {
  safeSet(
    RECENT_KEY,
    getRecentLists().filter((l) => l.code !== code),
  );
}

// Clés d'édition des listes que cet appareil peut modifier (créées ici, ou
// ouvertes via un lien d'édition). Jamais envoyées ailleurs qu'au serveur de
// la liste concernée.
function getEditKeys(): Record<string, string> {
  return safeParse<Record<string, string>>(safeGet(KEYS_KEY)) ?? {};
}

export function getEditKey(code: string): string | null {
  return getEditKeys()[code] ?? null;
}

export function saveEditKey(code: string, key: string): void {
  safeSet(KEYS_KEY, { ...getEditKeys(), [code]: key });
}

export function forgetEditKey(code: string): void {
  const keys = getEditKeys();
  delete keys[code];
  safeSet(KEYS_KEY, keys);
}

// Réservations faites depuis cet appareil : code → (id du souhait → jeton).
// Le jeton est le seul moyen d'annuler sa propre réservation.
const RESERVATIONS_KEY = "kkjv:reservations";

function getAllReservationTokens(): Record<string, Record<string, string>> {
  return safeParse<Record<string, Record<string, string>>>(safeGet(RESERVATIONS_KEY)) ?? {};
}

export function getReservationTokens(code: string): Record<string, string> {
  return getAllReservationTokens()[code] ?? {};
}

export function saveReservationToken(code: string, itemId: string, token: string): void {
  const all = getAllReservationTokens();
  all[code] = { ...all[code], [itemId]: token };
  safeSet(RESERVATIONS_KEY, all);
}

export function forgetReservationToken(code: string, itemId: string): void {
  const all = getAllReservationTokens();
  if (!all[code]?.[itemId]) return;
  delete all[code][itemId];
  safeSet(RESERVATIONS_KEY, all);
}

export function cacheListState(state: ListState): void {
  safeSet(CACHE_PREFIX + state.code, state);
}

export function getCachedListState(code: string): ListState | null {
  return safeParse<ListState>(safeGet(CACHE_PREFIX + code));
}
