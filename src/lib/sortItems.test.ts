import { describe, it, expect } from "vitest";
import { isSortMode, sortItems } from "./sortItems";

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
