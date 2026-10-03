import { describe, it, expect } from "vitest";
import { editKeyFromHash, editUrl, readUrl } from "./editLink";

const KEY = "0123456789abcdef0123456789abcdef";

describe("editKeyFromHash", () => {
  it("extrait une clé bien formée, avec ou sans #", () => {
    expect(editKeyFromHash(`#cle=${KEY}`)).toBe(KEY);
    expect(editKeyFromHash(`cle=${KEY}&x=1`)).toBe(KEY);
  });

  it("renvoie null sans clé ou pour une clé mal formée", () => {
    expect(editKeyFromHash("")).toBeNull();
    expect(editKeyFromHash("#autre=1")).toBeNull();
    expect(editKeyFromHash("#cle=pas-une-cle")).toBeNull();
  });
});

it("construit les liens de lecture et d'édition", () => {
  expect(readUrl("https://a.fr", "/l/ABCDEF")).toBe("https://a.fr/l/ABCDEF");
  expect(editUrl("https://a.fr", "/l/ABCDEF", KEY)).toBe(`https://a.fr/l/ABCDEF#cle=${KEY}`);
  expect(editKeyFromHash(new URL(editUrl("https://a.fr", "/l/ABCDEF", KEY)).hash)).toBe(KEY);
});
