/** Côté le plus long d'une photo après redimensionnement : largement assez
 * pour un affichage plein écran sur téléphone, et quelques centaines de Ko
 * en JPEG au lieu de plusieurs Mo pour une photo d'appareil récent. */
export const MAX_IMAGE_DIMENSION = 1600;

/** Dimensions cibles en gardant les proportions, sans jamais agrandir. */
export function fitWithin(width: number, height: number, max: number = MAX_IMAGE_DIMENSION): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Message lisible pour une erreur d'envoi : un échec réseau de fetch()
 * arrive sous forme de TypeError au libellé anglais propre au navigateur
 * ("Failed to fetch", "Load failed"…), inutile pour l'utilisateur. */
export function uploadErrorMessage(err: unknown): string {
  if (err instanceof TypeError) return "Photo non enregistrée : problème de connexion. Réessaie.";
  if (err instanceof Error && err.message) return `Photo non enregistrée : ${err.message}`;
  return "Photo non enregistrée.";
}
