import { describe, it, expect } from "vitest";
import { applyReservation, hashToken, isWellFormedToken, viewForRole, type Reservations } from "./reservations";
import type { Item, ListState } from "../shared/types";

const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

function item(id: string): Item {
  return { id, name: id, description: "", link: "", imageUrl: "", order: 0, createdAt: 0, updatedAt: 0, hasImage: false, imageVersion: 0 };
}

function state(...ids: string[]): ListState {
  return { code: "ABCDEF", name: "Liste", items: ids.map(item), createdAt: 0, updatedAt: 0 };
}

async function reserve(s: ListState, r: Reservations, id: string, token: string) {
  return applyReservation(s, r, { type: "reserveItem", id, token });
}

async function unreserve(s: ListState, r: Reservations, id: string, token: string) {
  return applyReservation(s, r, { type: "unreserveItem", id, token });
}

describe("isWellFormedToken / hashToken", () => {
  it("n'accepte que 32 caractères hexadécimaux", () => {
    expect(isWellFormedToken(TOKEN_A)).toBe(true);
    expect(isWellFormedToken("xyz")).toBe(false);
    expect(isWellFormedToken(42)).toBe(false);
  });

  it("produit une empreinte stable qui ne contient pas le jeton", async () => {
    const hash = await hashToken(TOKEN_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(TOKEN_A)).toBe(hash);
    expect(hash).not.toContain(TOKEN_A);
  });
});

describe("applyReservation", () => {
  it("réserve un souhait sans modifier les réservations reçues", async () => {
    const before: Reservations = {};
    const result = await reserve(state("x"), before, "x", TOKEN_A);
    expect(result).toEqual({ ok: true, reservations: { x: await hashToken(TOKEN_A) } });
    expect(before).toEqual({});
  });

  it("refuse de réserver un souhait déjà réservé par un autre appareil", async () => {
    const s = state("x");
    const first = await reserve(s, {}, "x", TOKEN_A);
    if (!first.ok) throw new Error();
    expect(await reserve(s, first.reservations, "x", TOKEN_B)).toEqual({
      ok: false,
      error: "Ce souhait est déjà réservé par quelqu'un d'autre.",
    });
    // Le même appareil peut re-réserver (idempotent).
    expect((await reserve(s, first.reservations, "x", TOKEN_A)).ok).toBe(true);
  });

  it("seul l'appareil qui a réservé peut annuler", async () => {
    const s = state("x");
    const first = await reserve(s, {}, "x", TOKEN_A);
    if (!first.ok) throw new Error();
    expect(await unreserve(s, first.reservations, "x", TOKEN_B)).toEqual({
      ok: false,
      error: "Seule la personne qui a réservé peut annuler.",
    });
    expect(await unreserve(s, first.reservations, "x", TOKEN_A)).toEqual({ ok: true, reservations: {} });
  });

  it("annuler une réservation inexistante ne fait rien", async () => {
    expect(await unreserve(state("x"), {}, "x", TOKEN_A)).toEqual({ ok: true, reservations: {} });
  });

  it("refuse un souhait inconnu, un id invalide ou un jeton mal formé", async () => {
    const s = state("x");
    expect(await reserve(s, {}, "inconnu", TOKEN_A)).toEqual({ ok: false, error: "Ce souhait n'existe plus." });
    expect(await reserve(s, {}, 'x"', TOKEN_A)).toEqual({ ok: false, error: "Ce souhait n'existe plus." });
    expect(await reserve(s, {}, "x", "court")).toEqual({ ok: false, error: "Réservation invalide." });
  });

  it("nettoie les réservations de souhaits supprimés", async () => {
    const result = await reserve(state("x"), { supprime: "hash" }, "x", TOKEN_A);
    expect(result.ok && Object.keys(result.reservations)).toEqual(["x"]);
  });
});

describe("viewForRole", () => {
  const s = state("x", "y");
  const reservations: Reservations = { x: "hash" };

  it("n'envoie aucune réservation au propriétaire, ni à son aperçu invité", () => {
    for (const role of ["editor", "preview"] as const) {
      const view = viewForRole(s, reservations, role);
      expect(view).toBe(s);
      expect(JSON.stringify(view)).not.toContain("reserved");
    }
  });

  it("marque les souhaits réservés pour les invités, sans l'empreinte ni modifier l'état", () => {
    const view = viewForRole(s, reservations, "viewer");
    expect(view.items.map((i) => i.reserved)).toEqual([true, undefined]);
    expect(JSON.stringify(view)).not.toContain("hash");
    expect(s.items[0]).not.toHaveProperty("reserved");
  });
});
