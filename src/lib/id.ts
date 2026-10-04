export function uid(): string {
  return crypto.randomUUID();
}

/** Secret aléatoire de 32 caractères hexadécimaux (jeton de réservation). */
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
