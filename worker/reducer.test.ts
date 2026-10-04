import { describe, it, expect } from "vitest";
import { applyMessage, isAllowedFromClient, isValidId, nextOrder, normalizePrice, normalizeUrl } from "./reducer";
import type { Item, ListState } from "../shared/types";
import { MAX_DESCRIPTION_LENGTH, MAX_ITEMS_PER_LIST, MAX_NAME_LENGTH } from "../shared/types";

function makeState(items: Item[] = []): ListState {
  return { code: "ABCDEF", name: "Ma liste", items, createdAt: 1, updatedAt: 1 };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    name: "Livre",
    description: "",
    link: "",
    imageUrl: "",
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    hasImage: false,
    imageVersion: 0,
    ...overrides,
  };
}

describe("nextOrder", () => {
  it("renvoie 0 pour une liste vide", () => {
    expect(nextOrder([])).toBe(0);
  });

  it("renvoie le plus grand ordre + 1", () => {
    expect(nextOrder([{ order: 3 }, { order: 7 }, { order: 1 }])).toBe(8);
  });
});

describe("normalizeUrl", () => {
  it("garde une URL http(s) valide", () => {
    expect(normalizeUrl("https://exemple.fr/produit")).toBe("https://exemple.fr/produit");
    expect(normalizeUrl("http://exemple.fr/")).toBe("http://exemple.fr/");
  });

  it("ajoute https:// quand le schéma manque", () => {
    expect(normalizeUrl("  exemple.fr/p  ")).toBe("https://exemple.fr/p");
  });

  it("refuse les autres schémas", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBe("");
    expect(normalizeUrl("data:text/html,x")).toBe("");
  });

  it("renvoie une chaîne vide pour une entrée vide, invalide ou non textuelle", () => {
    expect(normalizeUrl("   ")).toBe("");
    expect(normalizeUrl("http://")).toBe("");
    expect(normalizeUrl(42)).toBe("");
    expect(normalizeUrl(undefined)).toBe("");
  });
});

describe("normalizePrice", () => {
  it("arrondit au centime", () => {
    expect(normalizePrice(19.999)).toBe(20);
    expect(normalizePrice(12.345)).toBe(12.35);
    expect(normalizePrice(0)).toBe(0);
  });

  it("rejette les valeurs négatives, non finies ou non numériques", () => {
    expect(normalizePrice(-1)).toBeUndefined();
    expect(normalizePrice(Number.NaN)).toBeUndefined();
    expect(normalizePrice(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizePrice("12")).toBeUndefined();
  });
});

describe("isValidId", () => {
  it("accepte un id généré par l'app", () => {
    expect(isValidId("0b9e7c1e-2d1f-4c4e-9f0a-1234567890ab")).toBe(true);
  });

  it("refuse un id vide, trop long, non textuel ou avec des caractères spéciaux", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("a".repeat(65))).toBe(false);
    expect(isValidId('x"y')).toBe(false);
    expect(isValidId(12)).toBe(false);
  });
});

describe("isAllowedFromClient", () => {
  it("autorise sync à tout le monde", () => {
    expect(isAllowedFromClient({ type: "sync" }, "viewer")).toBe(true);
    expect(isAllowedFromClient({ type: "sync" }, "editor")).toBe(true);
  });

  it("refuse toute modification en lecture seule", () => {
    expect(isAllowedFromClient({ type: "renameList", name: "x" }, "viewer")).toBe(false);
    expect(isAllowedFromClient({ type: "addItem", id: "a", name: "x" }, "viewer")).toBe(false);
    expect(isAllowedFromClient({ type: "deleteItem", id: "a" }, "viewer")).toBe(false);
  });

  it("autorise les modifications à l'éditeur", () => {
    expect(isAllowedFromClient({ type: "addItem", id: "a", name: "x" }, "editor")).toBe(true);
  });

  it("refuse toujours setItemImage venant d'un client, même éditeur", () => {
    expect(isAllowedFromClient({ type: "setItemImage", id: "a", hasImage: true }, "editor")).toBe(false);
  });
});

describe("applyMessage", () => {
  it("sync ne change rien", () => {
    const state = makeState([makeItem()]);
    const before = structuredClone(state);
    applyMessage(state, { type: "sync" });
    expect(state).toEqual(before);
  });

  describe("renameList", () => {
    it("renomme la liste (espaces retirés, longueur bornée)", () => {
      const state = makeState();
      applyMessage(state, { type: "renameList", name: "  Anniversaire  " });
      expect(state.name).toBe("Anniversaire");
      applyMessage(state, { type: "renameList", name: "x".repeat(500) });
      expect(state.name).toHaveLength(MAX_NAME_LENGTH);
    });

    it("ignore un nom vide", () => {
      const state = makeState();
      applyMessage(state, { type: "renameList", name: "   " });
      expect(state.name).toBe("Ma liste");
    });
  });

  describe("addItem", () => {
    it("ajoute un souhait avec tous ses champs normalisés", () => {
      const state = makeState([makeItem({ order: 4 })]);
      applyMessage(
        state,
        {
          type: "addItem",
          id: "new-1",
          name: "  Casque audio ",
          description: " Couleur noire ",
          link: "boutique.fr/casque",
          imageUrl: "https://img.fr/casque.jpg",
          price: 79.999,
        },
        100,
      );
      expect(state.items[1]).toEqual({
        id: "new-1",
        name: "Casque audio",
        description: "Couleur noire",
        link: "https://boutique.fr/casque",
        imageUrl: "https://img.fr/casque.jpg",
        price: 80,
        order: 5,
        createdAt: 100,
        updatedAt: 100,
        hasImage: false,
        imageVersion: 0,
      });
    });

    it("ajoute un souhait minimal, sans prix", () => {
      const state = makeState();
      applyMessage(state, { type: "addItem", id: "new-1", name: "Livre" }, 5);
      expect(state.items[0]).toMatchObject({ name: "Livre", description: "", link: "", imageUrl: "", order: 0 });
      expect(state.items[0]).not.toHaveProperty("price");
    });

    it("ignore un nom vide, un id invalide ou déjà utilisé", () => {
      const state = makeState([makeItem({ id: "dup" })]);
      applyMessage(state, { type: "addItem", id: "ok", name: "  " });
      applyMessage(state, { type: "addItem", id: "bad id!", name: "Livre" });
      applyMessage(state, { type: "addItem", id: "dup", name: "Livre" });
      expect(state.items).toHaveLength(1);
    });

    it("respecte le nombre max de souhaits", () => {
      const items = Array.from({ length: MAX_ITEMS_PER_LIST }, (_, i) => makeItem({ id: `i${i}`, order: i }));
      const state = makeState(items);
      applyMessage(state, { type: "addItem", id: "one-more", name: "Livre" });
      expect(state.items).toHaveLength(MAX_ITEMS_PER_LIST);
    });

    it("ne garde pas un prix invalide", () => {
      const state = makeState();
      applyMessage(state, { type: "addItem", id: "a", name: "Livre", price: -3 });
      expect(state.items[0]).not.toHaveProperty("price");
    });
  });

  describe("updateItem", () => {
    it("modifie uniquement les champs fournis", () => {
      const state = makeState([makeItem({ description: "garde", price: 10 })]);
      applyMessage(state, { type: "updateItem", id: "item-1", name: "Roman", link: "exemple.fr" }, 50);
      expect(state.items[0]).toMatchObject({
        name: "Roman",
        description: "garde",
        link: "https://exemple.fr/",
        price: 10,
        updatedAt: 50,
      });
    });

    it("tronque la description et ignore un nom vide", () => {
      const state = makeState([makeItem()]);
      applyMessage(state, { type: "updateItem", id: "item-1", name: " ", description: "d".repeat(5000) });
      expect(state.items[0].name).toBe("Livre");
      expect(state.items[0].description).toHaveLength(MAX_DESCRIPTION_LENGTH);
    });

    it("efface le prix avec null, ignore un prix invalide", () => {
      const state = makeState([makeItem({ price: 10 })]);
      applyMessage(state, { type: "updateItem", id: "item-1", price: Number.NaN });
      expect(state.items[0].price).toBe(10);
      applyMessage(state, { type: "updateItem", id: "item-1", price: 12.5 });
      expect(state.items[0].price).toBe(12.5);
      applyMessage(state, { type: "updateItem", id: "item-1", price: null });
      expect(state.items[0]).not.toHaveProperty("price");
    });

    it("vide un lien ou une image distante", () => {
      const state = makeState([makeItem({ link: "https://a.fr/", imageUrl: "https://a.fr/i.png" })]);
      applyMessage(state, { type: "updateItem", id: "item-1", link: "", imageUrl: "javascript:x" });
      expect(state.items[0].link).toBe("");
      expect(state.items[0].imageUrl).toBe("");
    });

    it("ignore un souhait inconnu", () => {
      const state = makeState([makeItem()]);
      const before = structuredClone(state);
      applyMessage(state, { type: "updateItem", id: "inconnu", name: "x" });
      expect(state).toEqual(before);
    });
  });

  it("deleteItem supprime le souhait", () => {
    const state = makeState([makeItem({ id: "a" }), makeItem({ id: "b" })]);
    applyMessage(state, { type: "deleteItem", id: "a" });
    expect(state.items.map((i) => i.id)).toEqual(["b"]);
  });

  describe("reorderItems", () => {
    it("réordonne selon la liste d'ids, ignore les ids inconnus", () => {
      const state = makeState([makeItem({ id: "a", order: 0 }), makeItem({ id: "b", order: 1 }), makeItem({ id: "c", order: 2 })]);
      applyMessage(state, { type: "reorderItems", orderedIds: ["c", "zzz", "a"] });
      expect(state.items.map((i) => [i.id, i.order])).toEqual([
        ["a", 2],
        ["b", 1],
        ["c", 0],
      ]);
    });

    it("ignore une liste d'ids qui n'est pas un tableau", () => {
      const state = makeState([makeItem({ id: "a", order: 3 })]);
      applyMessage(state, { type: "reorderItems", orderedIds: "a" as unknown as string[] });
      expect(state.items[0].order).toBe(3);
    });
  });

  describe("setItemImage", () => {
    it("met à jour le drapeau et incrémente la version", () => {
      const state = makeState([makeItem()]);
      applyMessage(state, { type: "setItemImage", id: "item-1", hasImage: true }, 9);
      expect(state.items[0]).toMatchObject({ hasImage: true, imageVersion: 1, updatedAt: 9 });
      applyMessage(state, { type: "setItemImage", id: "item-1", hasImage: false });
      expect(state.items[0]).toMatchObject({ hasImage: false, imageVersion: 2 });
    });

    it("ignore un souhait inconnu", () => {
      const state = makeState();
      applyMessage(state, { type: "setItemImage", id: "x", hasImage: true });
      expect(state.items).toEqual([]);
    });
  });

  describe("restoreItem", () => {
    it("réinsère un souhait supprimé tel quel", () => {
      const item = makeItem({ id: "r", order: 3, description: "d", link: "https://a.fr/", price: 5, hasImage: true, imageVersion: 2 });
      const state = makeState();
      applyMessage(state, { type: "restoreItem", item }, 77);
      expect(state.items[0]).toEqual({ ...item, updatedAt: 77 });
    });

    it("renormalise un contenu forgé", () => {
      const forged = {
        id: "r",
        name: "  ",
        description: 3,
        link: "javascript:x",
        imageUrl: "",
        price: -2,
        order: Number.NaN,
        createdAt: Number.NaN,
        hasImage: "oui",
        imageVersion: -1,
        evil: "<script>",
      } as unknown as Item;
      const state = makeState([makeItem({ id: "a", order: 4 })]);
      applyMessage(state, { type: "restoreItem", item: forged }, 10);
      expect(state.items[1]).toEqual({
        id: "r",
        name: "Souhait",
        description: "",
        link: "",
        imageUrl: "",
        order: 5,
        createdAt: 10,
        updatedAt: 10,
        hasImage: false,
        imageVersion: 0,
      });
    });

    it("ignore un id invalide, déjà présent, un contenu absent, ou une liste pleine", () => {
      const state = makeState([makeItem({ id: "a" })]);
      applyMessage(state, { type: "restoreItem", item: makeItem({ id: "a", name: "Autre" }) });
      applyMessage(state, { type: "restoreItem", item: makeItem({ id: "bad id" }) });
      applyMessage(state, { type: "restoreItem", item: undefined as unknown as Item });
      expect(state.items).toHaveLength(1);
      expect(state.items[0].name).toBe("Livre");

      const full = makeState(Array.from({ length: MAX_ITEMS_PER_LIST }, (_, i) => makeItem({ id: `i${i}` })));
      applyMessage(full, { type: "restoreItem", item: makeItem({ id: "extra" }) });
      expect(full.items).toHaveLength(MAX_ITEMS_PER_LIST);
    });
  });
});

describe("réservations (gérées hors du reducer)", () => {
  it("seuls les invités peuvent réserver ou annuler (ni l'éditeur, ni son aperçu)", () => {
    const reserve = { type: "reserveItem", id: "a", token: "t" } as const;
    const unreserve = { type: "unreserveItem", id: "a", token: "t" } as const;
    expect(isAllowedFromClient(reserve, "viewer")).toBe(true);
    expect(isAllowedFromClient(unreserve, "viewer")).toBe(true);
    expect(isAllowedFromClient(reserve, "editor")).toBe(false);
    expect(isAllowedFromClient(unreserve, "editor")).toBe(false);
    expect(isAllowedFromClient(reserve, "preview")).toBe(false);
  });

  it("l'aperçu du propriétaire est en lecture seule", () => {
    expect(isAllowedFromClient({ type: "sync" }, "preview")).toBe(true);
    expect(isAllowedFromClient({ type: "deleteItem", id: "a" }, "preview")).toBe(false);
  });

  it("applyMessage ne touche pas à l'état pour une réservation", () => {
    const state = makeState([makeItem()]);
    const before = structuredClone(state);
    applyMessage(state, { type: "reserveItem", id: "item-1", token: "t" });
    applyMessage(state, { type: "unreserveItem", id: "item-1", token: "t" });
    expect(state).toEqual(before);
  });
});
