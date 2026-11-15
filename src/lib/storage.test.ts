// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheListState,
  forgetEditKey,
  forgetRecentList,
  forgetReservationToken,
  getCachedListState,
  getEditKey,
  getRecentLists,
  getReservationTokens,
  saveEditKey,
  saveReservationToken,
  touchRecentList,
} from "./storage";
import type { ListState } from "../../shared/types";

const sampleState: ListState = { code: "ABCDEF", name: "Noël", items: [], createdAt: 0, updatedAt: 0 };

function throwing(method: "getItem" | "setItem") {
  return vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new Error("indisponible");
  });
}

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("listes récentes", () => {
    it("est vide au départ", () => {
      expect(getRecentLists()).toEqual([]);
    });

    it("mémorise sous « kkjv:recent », la plus récemment ouverte d'abord", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      touchRecentList("AAAAAA", "Un");
      vi.setSystemTime(2000);
      touchRecentList("BBBBBB", "Deux");
      expect(getRecentLists()).toEqual([
        { code: "BBBBBB", name: "Deux", lastOpened: 2000 },
        { code: "AAAAAA", name: "Un", lastOpened: 1000 },
      ]);
      expect(JSON.parse(localStorage.getItem("kkjv:recent")!)).toHaveLength(2);
    });

    it("rouvrir une liste la remonte sans doublon et met à jour son nom", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      touchRecentList("AAAAAA", "Un");
      vi.setSystemTime(2000);
      touchRecentList("BBBBBB", "Deux");
      vi.setSystemTime(3000);
      touchRecentList("AAAAAA", "Un bis");
      expect(getRecentLists()).toEqual([
        { code: "AAAAAA", name: "Un bis", lastOpened: 3000 },
        { code: "BBBBBB", name: "Deux", lastOpened: 2000 },
      ]);
    });

    it("trie à la lecture même si le stockage est désordonné", () => {
      localStorage.setItem("kkjv:recent", JSON.stringify([{ code: "A", name: "a", lastOpened: 1 }, { code: "B", name: "b", lastOpened: 5 }, { code: "C", name: "c", lastOpened: 3 }]));
      expect(getRecentLists().map((l) => l.code)).toEqual(["B", "C", "A"]);
    });

    it("garde au plus 20 listes (les plus récentes)", () => {
      vi.useFakeTimers();
      for (let i = 0; i < 22; i++) {
        vi.setSystemTime(1000 + i);
        touchRecentList(`C${i}`, `n${i}`);
      }
      const recents = getRecentLists();
      expect(recents).toHaveLength(20);
      expect(recents[0].code).toBe("C21");
      expect(recents[19].code).toBe("C2");
    });

    it("oublier une liste ne retire qu'elle", () => {
      touchRecentList("AAAAAA", "Un");
      touchRecentList("BBBBBB", "Deux");
      forgetRecentList("AAAAAA");
      expect(getRecentLists().map((l) => l.code)).toEqual(["BBBBBB"]);
    });

    it.each([["pas du json"], ["null"], [""]])("tolère un stockage corrompu (%j)", (raw) => {
      localStorage.setItem("kkjv:recent", raw);
      expect(getRecentLists()).toEqual([]);
    });

    it("tolère un localStorage qui lève", () => {
      const get = throwing("getItem");
      expect(getRecentLists()).toEqual([]);
      get.mockRestore();
      const set = throwing("setItem");
      expect(() => touchRecentList("AAAAAA", "Un")).not.toThrow();
      set.mockRestore();
    });
  });

  describe("clés d'édition", () => {
    it("renvoie null sans clé", () => {
      expect(getEditKey("ABCDEF")).toBeNull();
    });

    it("enregistre sous « kkjv:editKeys », une clé par liste, sans écraser les autres", () => {
      saveEditKey("AAAAAA", "k1");
      saveEditKey("BBBBBB", "k2");
      expect(getEditKey("AAAAAA")).toBe("k1");
      expect(getEditKey("BBBBBB")).toBe("k2");
      expect(JSON.parse(localStorage.getItem("kkjv:editKeys")!)).toEqual({ AAAAAA: "k1", BBBBBB: "k2" });
    });

    it("oublier une clé ne retire qu'elle", () => {
      saveEditKey("AAAAAA", "k1");
      saveEditKey("BBBBBB", "k2");
      forgetEditKey("AAAAAA");
      expect(getEditKey("AAAAAA")).toBeNull();
      expect(getEditKey("BBBBBB")).toBe("k2");
    });

    it("tolère un stockage corrompu et un localStorage qui lève", () => {
      localStorage.setItem("kkjv:editKeys", "pas du json");
      expect(getEditKey("A")).toBeNull();
      const get = throwing("getItem");
      expect(getEditKey("A")).toBeNull();
      get.mockRestore();
      const set = throwing("setItem");
      expect(() => saveEditKey("A", "k")).not.toThrow();
      set.mockRestore();
    });
  });

  describe("jetons de réservation", () => {
    it("est vide sans réservation", () => {
      expect(getReservationTokens("ABCDEF")).toEqual({});
    });

    it("enregistre sous « kkjv:reservations », par liste puis par souhait", () => {
      saveReservationToken("AAAAAA", "i1", "t1");
      saveReservationToken("AAAAAA", "i2", "t2");
      saveReservationToken("BBBBBB", "i1", "t3");
      expect(getReservationTokens("AAAAAA")).toEqual({ i1: "t1", i2: "t2" });
      expect(getReservationTokens("BBBBBB")).toEqual({ i1: "t3" });
      expect(JSON.parse(localStorage.getItem("kkjv:reservations")!)).toEqual({ AAAAAA: { i1: "t1", i2: "t2" }, BBBBBB: { i1: "t3" } });
    });

    it("oublier un jeton ne retire que lui", () => {
      saveReservationToken("AAAAAA", "i1", "t1");
      saveReservationToken("AAAAAA", "i2", "t2");
      forgetReservationToken("AAAAAA", "i1");
      expect(getReservationTokens("AAAAAA")).toEqual({ i2: "t2" });
    });

    it("oublier un jeton absent n'écrit rien", () => {
      saveReservationToken("AAAAAA", "i1", "t1");
      const set = vi.spyOn(Storage.prototype, "setItem");
      forgetReservationToken("AAAAAA", "inconnu");
      forgetReservationToken("ZZZZZZ", "i1");
      expect(set).not.toHaveBeenCalled();
      expect(getReservationTokens("AAAAAA")).toEqual({ i1: "t1" });
    });
  });

  describe("cache de liste", () => {
    it("relit exactement l'état mis en cache, sous « kkjv:cache:CODE »", () => {
      cacheListState(sampleState);
      expect(getCachedListState("ABCDEF")).toEqual(sampleState);
      expect(localStorage.getItem("kkjv:cache:ABCDEF")).not.toBeNull();
    });

    it("renvoie null sans cache, avec un cache corrompu ou si localStorage lève", () => {
      expect(getCachedListState("ABCDEF")).toBeNull();
      localStorage.setItem("kkjv:cache:ABCDEF", "{ pas du json");
      expect(getCachedListState("ABCDEF")).toBeNull();
      localStorage.setItem("kkjv:cache:ABCDEF", "");
      expect(getCachedListState("ABCDEF")).toBeNull();
      const get = throwing("getItem");
      expect(getCachedListState("ABCDEF")).toBeNull();
      get.mockRestore();
    });

    it("ne lève pas si localStorage.setItem lève", () => {
      const set = throwing("setItem");
      expect(() => cacheListState(sampleState)).not.toThrow();
      set.mockRestore();
    });
  });
});
