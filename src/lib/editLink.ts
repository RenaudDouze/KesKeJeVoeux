// Le lien d'édition porte la clé dans le fragment (#cle=...) plutôt que dans
// le chemin ou la query string : le fragment n'est jamais envoyé au serveur
// (ni journalisé, ni transmis en Referer), et l'app le retire de la barre
// d'adresse dès l'ouverture (voir main.ts) pour qu'un simple copier-coller
// de l'URL ne partage jamais par mégarde le droit de modifier.

const PARAM = "cle";

/** Extrait la clé d'édition d'un fragment d'URL ("#cle=..."), ou null. */
export function editKeyFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const key = params.get(PARAM);
  return key && /^[0-9a-f]{32}$/.test(key) ? key : null;
}

/** Lien de lecture seule : celui qu'on partage. */
export function readUrl(origin: string, listPath: string): string {
  return `${origin}${listPath}`;
}

/** Lien d'édition : à garder pour soi (ou ses autres appareils). */
export function editUrl(origin: string, listPath: string, key: string): string {
  return `${origin}${listPath}#${PARAM}=${key}`;
}
