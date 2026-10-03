import { describe, it, expect } from "vitest";
import { generateCode, generateEditKey, hashEditKey, isWellFormedEditKey, normalizeCode, verifyEditKey } from "./access";

describe("generateCode", () => {
  it("génère un code de 6 caractères sans caractères ambigus", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("respecte la longueur demandée", () => {
    expect(generateCode(8)).toHaveLength(8);
  });
});

it("normalizeCode met en majuscules et retire les espaces", () => {
  expect(normalizeCode("  abc123 ")).toBe("ABC123");
});

describe("clé d'édition", () => {
  it("génère une clé bien formée, différente à chaque fois", () => {
    const a = generateEditKey();
    const b = generateEditKey();
    expect(isWellFormedEditKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("isWellFormedEditKey refuse tout le reste", () => {
    expect(isWellFormedEditKey("abc")).toBe(false);
    expect(isWellFormedEditKey("Z".repeat(32))).toBe(false);
    expect(isWellFormedEditKey(null)).toBe(false);
  });

  it("vérifie une clé contre son empreinte", async () => {
    const key = generateEditKey();
    const hash = await hashEditKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    expect(await verifyEditKey(key, hash)).toBe(true);
    expect(await verifyEditKey(generateEditKey(), hash)).toBe(false);
  });

  it("refuse sans empreinte stockée ou avec une clé mal formée", async () => {
    const key = generateEditKey();
    expect(await verifyEditKey(key, null)).toBe(false);
    expect(await verifyEditKey(key, undefined)).toBe(false);
    expect(await verifyEditKey("pas-une-cle", await hashEditKey("pas-une-cle"))).toBe(false);
  });

  it("refuse une empreinte stockée de longueur différente", async () => {
    const key = generateEditKey();
    const hash = await hashEditKey(key);
    expect(await verifyEditKey(key, hash.slice(0, 10))).toBe(false);
  });
});
