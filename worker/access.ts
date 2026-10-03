// Génération des identifiants d'une liste et vérification de la clé
// d'édition. Deux secrets bien distincts :
// - le code (6 caractères) : public, identifie la liste et ne donne que la
//   lecture — c'est lui qu'on partage ;
// - la clé d'édition (aléatoire, 128 bits) : seule à autoriser les
//   modifications. Elle n'est jamais stockée en clair (seulement son
//   empreinte SHA-256) ni diffusée aux personnes connectées.

// Caractères ambigus (0/O, 1/I) exclus : plus facile à lire ou à dicter.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return out;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 16 octets aléatoires en hexadécimal (32 caractères) : impossible à
 * deviner, contrairement au code de lecture volontairement court. */
export function generateEditKey(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function isWellFormedEditKey(key: unknown): key is string {
  return typeof key === "string" && /^[0-9a-f]{32}$/.test(key);
}

export async function hashEditKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

/** Compare une clé fournie à l'empreinte stockée. Toujours faux sans
 * empreinte stockée ou pour une clé mal formée. */
export async function verifyEditKey(key: unknown, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash || !isWellFormedEditKey(key)) return false;
  const hash = await hashEditKey(key);
  // Comparaison à temps constant, par principe (les deux chaînes ont
  // toujours la même longueur : deux empreintes SHA-256 en hexadécimal).
  let diff = hash.length ^ storedHash.length;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
