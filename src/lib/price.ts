/** Format d'affichage français : "12,50 €" (toujours 2 décimales). */
export function formatPrice(price: number): string {
  return `${price.toFixed(2).replace(".", ",")} €`;
}

/** Lit la saisie libre d'un champ prix (virgule ou point comme séparateur
 * décimal, espaces et symbole € tolérés). `null` = champ vide (pas de prix) ;
 * `undefined` = saisie invalide, à signaler sans rien envoyer (le serveur
 * revalide de toute façon, voir worker/reducer.ts). */
export function parsePriceInput(raw: string): number | null | undefined {
  const trimmed = raw.replace(/[\s€]/g, "");
  if (!trimmed) return null;
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return undefined;
  return Math.round(Number.parseFloat(trimmed.replace(",", ".")) * 100) / 100;
}

/** Somme des prix renseignés ; null s'il n'y en a aucun. */
export function totalPrice(items: { price?: number }[]): number | null {
  const priced = items.filter((i) => typeof i.price === "number");
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((sum, i) => sum + (i.price as number), 0) * 100) / 100;
}
