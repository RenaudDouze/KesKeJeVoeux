import { describe, it, expect } from "vitest";
import { isSortMode, sortItems, SORT_MODES } from "./sortItems";

const items = [
  { id: "c", order: 2, price: 30 },
  { id: "a", order: 0, price: 10 },
  { id: "x", order: 1 },
  { id: "b", order: 3, price: 10 },
  { id: "y", order: 4 },
  { id: "d", order: 5, price: 50 },
];
const ids = (list: { id: string }[]) => list.map((i) => i.id);

describe("sortItems", () => {
  it("garde l'ordre défini par défaut", () => {
    expect(ids(sortItems(items, "order"))).toEqual(["a", "x", "c", "b", "y", "d"]);
  });

  it("trie par prix croissant, sans prix à la fin, égalités dans l'ordre défini", () => {
    expect(ids(sortItems(items, "price-asc"))).toEqual(["a", "b", "c", "d", "x", "y"]);
  });

  it("trie par prix décroissant, sans prix toujours à la fin", () => {
    expect(ids(sortItems(items, "price-desc"))).toEqual(["d", "c", "a", "b", "x", "y"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const copy = [...items];
    sortItems(items, "price-desc");
    expect(items).toEqual(copy);
  });
});

it("isSortMode ne reconnaît que les modes connus", () => {
  expect(isSortMode("price-asc")).toBe(true);
  expect(isSortMode("name")).toBe(false);
  expect(isSortMode(null)).toBe(false);
});

describe("modes de tri", () => {
  it("expose exactement les trois modes", () => {
    expect([...SORT_MODES]).toEqual(["order", "price-asc", "price-desc"]);
    for (const mode of SORT_MODES) expect(isSortMode(mode)).toBe(true);
    expect(isSortMode("price")).toBe(false);
    expect(isSortMode(1)).toBe(false);
  });

  it("place un souhait sans prix après un souhait avec prix, dans les deux sens et quel que soit l'ordre d'entrée", () => {
    const unpriced = { id: "u", order: 0 };
    const priced = { id: "p", order: 1, price: 5 };
    for (const mode of ["price-asc", "price-desc"] as const) {
      expect(ids(sortItems([unpriced, priced], mode))).toEqual(["p", "u"]);
      expect(ids(sortItems([priced, unpriced], mode))).toEqual(["p", "u"]);
    }
  });

  it("trie par prix décroissant", () => {
    expect(ids(sortItems(items, "price-desc"))).toEqual(["d", "c", "a", "b", "x", "y"]);
  });
});

describe("tri par prix : toutes les permutations d'entrée", () => {
  function permutations<T>(list: T[]): T[][] {
    if (list.length <= 1) return [list];
    return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
  }
  const base = [
    { id: "u1", order: 0 },
    { id: "p1", order: 1, price: 20 },
    { id: "u2", order: 2 },
    { id: "p2", order: 3, price: 10 },
  ];

  it("garde les souhaits sans prix à la fin, dans l'ordre défini, quel que soit l'ordre d'entrée", () => {
    for (const input of permutations(base)) {
      expect(ids(sortItems(input, "price-asc"))).toEqual(["p2", "p1", "u1", "u2"]);
      expect(ids(sortItems(input, "price-desc"))).toEqual(["p1", "p2", "u1", "u2"]);
    }
  });
});
