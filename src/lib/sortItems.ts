/** Tri d'affichage des souhaits, choisi par chacun sur son appareil (voir
 * sortPreference.ts) : n'a aucun effet sur l'ordre défini de la liste. */
export type SortMode = "order" | "price-asc" | "price-desc";

export const SORT_MODES: readonly SortMode[] = ["order", "price-asc", "price-desc"];

export function isSortMode(value: unknown): value is SortMode {
  return (SORT_MODES as readonly unknown[]).includes(value);
}

/** Trie sans modifier le tableau reçu. Par prix, les souhaits sans prix
 * restent à la fin quel que soit le sens, et les égalités gardent l'ordre
 * défini (tri stable sur une base déjà triée par `order`). */
export function sortItems<T extends { order: number; price?: number }>(items: readonly T[], mode: SortMode): T[] {
  const byOrder = [...items].sort((a, b) => a.order - b.order);
  if (mode === "order") return byOrder;
  // Les souhaits sans prix sont écartés avant le tri puis remis à la fin : un
  // comparateur qui mélange prix présents et absents serait incohérent.
  const priced = byOrder.filter((item) => item.price !== undefined);
  const unpriced = byOrder.filter((item) => item.price === undefined);
  priced.sort((a, b) => (mode === "price-asc" ? (a.price as number) - (b.price as number) : (b.price as number) - (a.price as number)));
  return [...priced, ...unpriced];
}
