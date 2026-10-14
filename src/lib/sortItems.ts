/** Tri d'affichage des souhaits, choisi par chacun sur son appareil (voir
 * sortPreference.ts) : n'a aucun effet sur l'ordre défini de la liste. */
export type SortMode = "order" | "price-asc" | "price-desc";

export const SORT_MODES: readonly SortMode[] = ["order", "price-asc", "price-desc"];

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value);
}

/** Trie sans modifier le tableau reçu. Par prix, les souhaits sans prix
 * restent à la fin quel que soit le sens, et les égalités gardent l'ordre
 * défini (tri stable sur une base déjà triée par `order`). */
export function sortItems<T extends { order: number; price?: number }>(items: readonly T[], mode: SortMode): T[] {
  const byOrder = [...items].sort((a, b) => a.order - b.order);
  if (mode === "order") return byOrder;
  const direction = mode === "price-asc" ? 1 : -1;
  return byOrder.sort((a, b) => {
    if (a.price === undefined || b.price === undefined) {
      return (a.price === undefined ? 1 : 0) - (b.price === undefined ? 1 : 0);
    }
    return (a.price - b.price) * direction;
  });
}
