import { isSortMode, type SortMode } from "./sortItems";

// Préférence personnelle, par appareil (comme le thème) : jamais synchronisée.
const KEY = "kkjv:sort";

export function getSortPreference(): SortMode {
  try {
    const stored = localStorage.getItem(KEY);
    return isSortMode(stored) ? stored : "order";
  } catch {
    return "order";
  }
}

export function setSortPreference(mode: SortMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // stockage indisponible : le tri ne sera simplement pas mémorisé
  }
}
