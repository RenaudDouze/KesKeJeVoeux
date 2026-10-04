import { MAX_IMAGE_BYTES } from "../../shared/types";
import { fitWithin } from "./imageSize";

/** Prépare une photo choisie sur l'appareil avant envoi : décodée par le
 * navigateur, redimensionnée (voir fitWithin) et réencodée en JPEG. Les
 * photos de téléphone dépassent souvent la limite de 5 Mo ou sont en HEIC
 * (iPhone) : les réencoder ici les rend toutes acceptables par le serveur.
 * Seul un GIF déjà assez léger est gardé tel quel (pour son animation). */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif" && file.size <= MAX_IMAGE_BYTES) return file;

  const source = await decode(file);
  try {
    const { width, height } = fitWithin(source.width, source.height);
    if (width === 0) throw new Error();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    // Fond blanc : une image PNG transparente deviendrait noire en JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source.image, 0, 0, width, height);
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    throw new Error("Image trop volumineuse, même compressée.");
  } finally {
    source.release();
  }
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

const UNREADABLE =
  "Ce navigateur ne sait pas lire ce format d'image (HEIC ?). Essaie une capture d'écran, ou une photo au format JPEG.";

async function decode(file: File): Promise<Decoded> {
  // createImageBitmap applique l'orientation EXIF (photo prise en portrait).
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Repli sur <img> ci-dessous (certains Safari décodent HEIC ainsi).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(UNREADABLE);
  }
}
