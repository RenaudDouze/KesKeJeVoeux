import { describe, expect, it, vi } from "vitest";
import { randomToken, uid } from "./id";

describe("id", () => {
  it("uid renvoie un UUID différent à chaque appel", () => {
    expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uid()).not.toBe(uid());
  });

  it("randomToken renvoie 32 caractères hexadécimaux, différents à chaque appel", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken()).not.toBe(randomToken());
  });

  it("randomToken complète chaque octet sur deux chiffres", () => {
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
      arr.fill(1);
      return arr;
    }) as typeof crypto.getRandomValues);
    expect(randomToken()).toBe("01".repeat(16));
    spy.mockRestore();
  });
});
