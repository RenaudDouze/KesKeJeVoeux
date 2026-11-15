// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSortPreference, setSortPreference } from "./sortPreference";
import { SORT_MODES } from "./sortItems";

describe("sortPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("vaut « order » par défaut", () => {
    expect(getSortPreference()).toBe("order");
  });

  it.each(SORT_MODES as readonly string[])("relit le mode %s", (mode) => {
    localStorage.setItem("kkjv:sort", mode);
    expect(getSortPreference()).toBe(mode);
  });

  it("retombe sur « order » pour une valeur invalide", () => {
    localStorage.setItem("kkjv:sort", "aléatoire");
    expect(getSortPreference()).toBe("order");
  });

  it("retombe sur « order » si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getSortPreference()).toBe("order");
    spy.mockRestore();
  });

  it("persiste le mode choisi, et ne lève pas si localStorage lève", () => {
    setSortPreference("price-asc");
    expect(localStorage.getItem("kkjv:sort")).toBe("price-asc");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setSortPreference("order")).not.toThrow();
    spy.mockRestore();
  });
});
