import { describe, it, expect } from "vitest";
import { fitWithin, uploadErrorMessage, MAX_IMAGE_DIMENSION } from "./imageSize";

describe("fitWithin", () => {
  it("réduit une grande photo en gardant les proportions", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: MAX_IMAGE_DIMENSION });
  });

  it("n'agrandit jamais une petite image", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("garde au moins 1 pixel et gère des dimensions invalides", () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(fitWithin(0, 50)).toEqual({ width: 0, height: 0 });
  });
});

describe("uploadErrorMessage", () => {
  it("traduit une erreur réseau", () => {
    expect(uploadErrorMessage(new TypeError("Failed to fetch"))).toBe("Photo non enregistrée : problème de connexion. Réessaie.");
  });

  it("reprend le message du serveur", () => {
    expect(uploadErrorMessage(new Error("Image trop volumineuse (5 Mo max)."))).toBe(
      "Photo non enregistrée : Image trop volumineuse (5 Mo max).",
    );
  });

  it("a un message par défaut", () => {
    expect(uploadErrorMessage(new Error(""))).toBe("Photo non enregistrée.");
    expect(uploadErrorMessage("??")).toBe("Photo non enregistrée.");
  });
});
