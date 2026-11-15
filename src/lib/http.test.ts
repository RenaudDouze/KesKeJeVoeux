// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createList, deleteItemImage, fetchListState, itemImageUrl, uploadItemImage } from "./http";
import type { ListState } from "../../shared/types";

const sampleState: ListState = { code: "ABCDEF", name: "Noël", items: [], createdAt: 0, updatedAt: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createList", () => {
  it("poste le nom et renvoie la liste créée avec sa clé d'édition", async () => {
    const response = { state: sampleState, editKey: "clé" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createList("Noël")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Noël" }) }),
    );
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(createList("x")).rejects.toThrow("Impossible de créer la liste.");
  });
});

describe("fetchListState", () => {
  it("renvoie l'état, avec le code encodé dans l'URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchListState("A B/C")).resolves.toEqual(sampleState);
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/A%20B%2FC");
  });

  it("renvoie null pour un code inconnu (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchListState("ZZZZZZ")).resolves.toBeNull();
  });

  it("lève une erreur réseau pour toute autre réponse non ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchListState("ABCDEF")).rejects.toThrow("Erreur réseau.");
  });
});

describe("itemImageUrl", () => {
  it("inclut la version dans la query string", () => {
    expect(itemImageUrl("ABCDEF", "item1", 3)).toBe("/api/lists/ABCDEF/items/item1/image?v=3");
  });

  it("encode le code et l'id", () => {
    expect(itemImageUrl("A B", "i/d", 0)).toBe("/api/lists/A%20B/items/i%2Fd/image?v=0");
  });
});

describe("uploadItemImage", () => {
  it("envoie le fichier en PUT avec son content-type et la clé d'édition", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob(["x"], { type: "image/png" });

    await uploadItemImage("ABCDEF", "item1", file, "clé");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists/ABCDEF/items/item1/image",
      expect.objectContaining({ method: "PUT", headers: { "content-type": "image/png", "x-edit-key": "clé" }, body: file }),
    );
  });

  it("remonte le message du serveur, sinon un message générique", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Trop gros" }) }));
    await expect(uploadItemImage("A", "i", new Blob(["x"]), "k")).rejects.toThrow("Trop gros");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(uploadItemImage("A", "i", new Blob(["x"]), "k")).rejects.toThrow("Impossible d'envoyer l'image.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error("pas du json")) }));
    await expect(uploadItemImage("A", "i", new Blob(["x"]), "k")).rejects.toThrow("Impossible d'envoyer l'image.");
  });
});

describe("deleteItemImage", () => {
  it("envoie un DELETE avec la clé d'édition", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await deleteItemImage("ABCDEF", "item1", "clé");
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/ABCDEF/items/item1/image", { method: "DELETE", headers: { "x-edit-key": "clé" } });
  });

  it("remonte le message du serveur, sinon un message générique", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Introuvable" }) }));
    await expect(deleteItemImage("A", "i", "k")).rejects.toThrow("Introuvable");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(deleteItemImage("A", "i", "k")).rejects.toThrow("Impossible de supprimer l'image.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error("x")) }));
    await expect(deleteItemImage("A", "i", "k")).rejects.toThrow("Impossible de supprimer l'image.");
  });
});
