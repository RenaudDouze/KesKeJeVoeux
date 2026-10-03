import { describe, it, expect } from "vitest";
import { formatPrice, parsePriceInput, totalPrice } from "./price";

it("formatPrice affiche deux décimales avec une virgule", () => {
  expect(formatPrice(12.5)).toBe("12,50 €");
  expect(formatPrice(0)).toBe("0,00 €");
});

describe("parsePriceInput", () => {
  it("accepte virgule, point, espaces et symbole €", () => {
    expect(parsePriceInput("12,5")).toBe(12.5);
    expect(parsePriceInput(" 1 299.999 € ")).toBe(1300);
    expect(parsePriceInput("40")).toBe(40);
  });

  it("renvoie null pour un champ vide", () => {
    expect(parsePriceInput("   ")).toBeNull();
  });

  it("renvoie undefined pour une saisie invalide", () => {
    expect(parsePriceInput("abc")).toBeUndefined();
    expect(parsePriceInput("-3")).toBeUndefined();
    expect(parsePriceInput("1,2,3")).toBeUndefined();
  });
});

describe("totalPrice", () => {
  it("additionne les prix renseignés", () => {
    expect(totalPrice([{ price: 10.1 }, {}, { price: 0.2 }])).toBe(10.3);
  });

  it("renvoie null sans aucun prix", () => {
    expect(totalPrice([{}, {}])).toBeNull();
    expect(totalPrice([])).toBeNull();
  });
});
