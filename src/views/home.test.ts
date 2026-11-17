// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHomeView } from "./home";
import type { ListState } from "../../shared/types";

const createList = vi.fn();
const fetchListState = vi.fn();
vi.mock("../lib/http", () => ({
  createList: (...a: unknown[]) => createList(...a),
  fetchListState: (...a: unknown[]) => fetchListState(...a),
}));

let recents: { code: string; name: string; lastOpened: number }[] = [];
let editKeys: Record<string, string> = {};
const forgetRecentList = vi.fn();
const forgetEditKey = vi.fn();
const saveEditKey = vi.fn();
const touchRecentList = vi.fn();
vi.mock("../lib/storage", () => ({
  getRecentLists: () => recents,
  getEditKey: (code: string) => editKeys[code] ?? null,
  forgetRecentList: (...a: unknown[]) => forgetRecentList(...a),
  forgetEditKey: (...a: unknown[]) => forgetEditKey(...a),
  saveEditKey: (...a: unknown[]) => saveEditKey(...a),
  touchRecentList: (...a: unknown[]) => touchRecentList(...a),
}));

const openAccessibilityModal = vi.fn();
vi.mock("../components/accessibilityModal", () => ({ openAccessibilityModal: () => openAccessibilityModal() }));

const installApp = vi.fn();
vi.mock("../components/installModal", () => ({ installApp: () => installApp() }));

let canInstall = false;
let availabilityListener: (() => void) | undefined;
const unsubscribe = vi.fn();
vi.mock("../lib/install", () => ({
  canOfferInstall: () => canInstall,
  onInstallAvailabilityChange: (l: () => void) => {
    availabilityListener = l;
    return unsubscribe;
  },
}));

interface ConfirmCall {
  button: HTMLElement;
  opts: { armedLabel: string; onConfirm: () => void };
}
const confirmCalls: ConfirmCall[] = [];
vi.mock("../lib/confirmClick", () => ({
  wireConfirmClick: (button: HTMLElement, opts: ConfirmCall["opts"]) => confirmCalls.push({ button, opts }),
}));

function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Noël", items: [], createdAt: 0, updatedAt: 0, ...overrides };
}

const stray = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).flatMap((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "")
      .map((n) => n.textContent),
  );

describe("mountHomeView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  const submit = (form: Element) => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    return event;
  };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const rec = (code: string, name = `Liste ${code}`) => ({ code, name, lastOpened: 1 });

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    recents = [];
    editKeys = {};
    canInstall = false;
    availabilityListener = undefined;
    confirmCalls.length = 0;
    for (const fn of [createList, fetchListState, forgetRecentList, forgetEditKey, saveEditKey, touchRecentList, openAccessibilityModal, installApp, unsubscribe]) fn.mockReset();
    navigate = vi.fn<(path: string) => void>();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche la version du projet en pied d'accueil (VER-09)", () => {
    mountHomeView(root, navigate);
    expect(root.querySelector(".app-version")?.textContent).toBe("Version 9.9.9-test");
  });

  it("affiche l'accueil sans section de listes quand il n'y en a pas, sans texte parasite", () => {
    mountHomeView(root, navigate);
    expect(root.querySelector("h1")!.textContent).toBe("KesKeJeVoeux");
    expect(Array.from(root.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Nouvelle liste", "Consulter une liste"]);
    expect(stray(".home, .card, .home-header")).toEqual([]);
    expect(root.querySelector("#btn-install")).toBeNull();
  });

  describe("listes récentes", () => {
    it("sépare « Mes listes » (clé d'édition) et « Listes consultées », avec leur mode", () => {
      recents = [rec("AAAAAA", "Ma liste"), rec("BBBBBB", "Autre"), rec("CCCCCC", "Mienne aussi"), rec("DDDDDD", "Autre bis")];
      editKeys = { AAAAAA: "k1", CCCCCC: "k3" };
      mountHomeView(root, navigate);

      const sections = Array.from(root.querySelectorAll("section.card")).map((s) => [s.querySelector("h2")!.textContent, Array.from(s.querySelectorAll(".recent-name")).map((n) => n.textContent)]);
      expect(sections).toEqual([
        ["Mes listes", ["Ma liste", "Mienne aussi"]],
        ["Nouvelle liste", []],
        ["Listes consultées", ["Autre", "Autre bis"]],
        ["Consulter une liste", []],
      ]);
      const tags = Array.from(root.querySelectorAll(".recent-item")).map((li) => [li.querySelector(".recent-name")!.textContent, li.querySelector(".mode-tag")!.textContent, li.querySelector(".mode-tag")!.className]);
      expect(tags).toEqual([
        ["Ma liste", "Ma liste", "mode-tag mode-tag-edit"],
        ["Mienne aussi", "Ma liste", "mode-tag mode-tag-edit"],
        ["Autre", "Lecture", "mode-tag mode-tag-read"],
        ["Autre bis", "Lecture", "mode-tag mode-tag-read"],
      ]);
      expect(stray(".home, .card, .recent-list")).toEqual([]);
    });

    it("échappe le nom et le code", () => {
      recents = [{ code: 'A"B', name: "<b>x</b>", lastOpened: 1 }];
      mountHomeView(root, navigate);
      expect(root.querySelector(".recent-name b")).toBeNull();
      expect(root.querySelector(".recent-name")!.textContent).toBe("<b>x</b>");
      expect((root.querySelector(".recent-open") as HTMLElement).dataset.code).toBe('A"B');
    });

    it("cliquer une liste navigue vers son code (la bonne, parmi plusieurs)", () => {
      recents = [rec("AAAAAA"), rec("BBBBBB")];
      mountHomeView(root, navigate);
      (root.querySelectorAll(".recent-open")[1] as HTMLElement).click();
      expect(navigate).toHaveBeenCalledWith("/l/BBBBBB");
    });

    it("oublier : confirmation en deux clics, libellé selon la clé ; confirmé, oublie liste et clé puis redessine", () => {
      recents = [rec("AAAAAA"), rec("BBBBBB")];
      editKeys = { AAAAAA: "k" };
      mountHomeView(root, navigate);
      const forgets = Array.from(root.querySelectorAll(".recent-forget")) as HTMLElement[];
      expect(forgets[0].getAttribute("aria-label")).toBe("Oublier cette liste");
      expect(forgets[0].getAttribute("title")).toBe("Oublier cette liste");
      const byCode = (code: string) => confirmCalls.find((c) => c.button.dataset.code === code)!;
      expect(byCode("AAAAAA").opts.armedLabel).toBe("Confirmer : oublier la liste et sa clé d'édition");
      expect(byCode("BBBBBB").opts.armedLabel).toBe("Confirmer : oublier la liste");

      root.querySelector(".home")!.setAttribute("data-marker", "1");
      byCode("BBBBBB").opts.onConfirm();
      expect(forgetRecentList).toHaveBeenCalledWith("BBBBBB");
      expect(forgetEditKey).toHaveBeenCalledWith("BBBBBB");
      expect(root.querySelector(".home")!.hasAttribute("data-marker")).toBe(false);
    });
  });

  describe("thème et accessibilité", () => {
    it("le bouton de thème affiche l'icône du thème courant et cycle", () => {
      const labels: string[] = [];
      for (const [theme, label] of [["system", "Auto"], ["light", "Clair"], ["dark", "Sombre"]] as const) {
        localStorage.setItem("kkjv:theme", theme);
        mountHomeView(root, navigate);
        const btn = root.querySelector("#theme-toggle")!;
        expect(btn.getAttribute("aria-label")).toBe(`Thème : ${label}`);
        expect(btn.getAttribute("title")).toBe(`Thème : ${label}`);
        expect(btn.querySelector("svg")).not.toBeNull();
        labels.push(btn.innerHTML.replace(/\s+/g, " "));
      }
      expect(new Set(labels).size).toBe(3);

      localStorage.setItem("kkjv:theme", "system");
      mountHomeView(root, navigate);
      (root.querySelector("#theme-toggle") as HTMLElement).click();
      expect(root.querySelector("#theme-toggle")!.getAttribute("aria-label")).toBe("Thème : Clair");
    });

    it("le bouton d'accessibilité ouvre sa modale", () => {
      mountHomeView(root, navigate);
      (root.querySelector("#btn-accessibility") as HTMLElement).click();
      expect(openAccessibilityModal).toHaveBeenCalledOnce();
    });
  });

  describe("installation", () => {
    it("propose le bouton quand c'est possible, et lance l'installation au clic", () => {
      canInstall = true;
      mountHomeView(root, navigate);
      const btn = root.querySelector("#btn-install") as HTMLElement;
      expect(btn.textContent!.trim()).toBe("Installer l'app sur ce téléphone");
      expect(btn.querySelector("svg")).not.toBeNull();
      btn.click();
      expect(installApp).toHaveBeenCalledOnce();
    });

    it("se redessine quand la possibilité d'installer change ; le nettoyage se désabonne", () => {
      const cleanup = mountHomeView(root, navigate);
      expect(root.querySelector("#btn-install")).toBeNull();
      canInstall = true;
      availabilityListener!();
      expect(root.querySelector("#btn-install")).not.toBeNull();
      cleanup();
      expect(cleanup).toBe(unsubscribe);
    });
  });

  describe("créer une liste", () => {
    const setup = () => {
      mountHomeView(root, navigate);
      return {
        form: root.querySelector("#create-form")!,
        input: root.querySelector("#create-name") as HTMLInputElement,
        btn: root.querySelector("#create-form button") as HTMLButtonElement,
      };
    };

    it("bloque l'envoi natif, désactive le bouton, recadre le nom, mémorise clé et liste puis navigue", async () => {
      const call = deferred<{ state: ListState; editKey: string }>();
      createList.mockReturnValue(call.promise);
      const { form, input, btn } = setup();
      input.value = "  Mon Noël  ";

      const event = submit(form);
      expect(event.defaultPrevented).toBe(true);
      expect(btn.disabled).toBe(true);
      expect(createList).toHaveBeenCalledWith("Mon Noël");

      call.resolve({ state: sampleState({ code: "NEWCOD", name: "Mon Noël" }), editKey: "clé" });
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/l/NEWCOD"));
      expect(saveEditKey).toHaveBeenCalledWith("NEWCOD", "clé");
      expect(touchRecentList).toHaveBeenCalledWith("NEWCOD", "Mon Noël");
    });

    it("sans nom, envoie une chaîne vide", async () => {
      createList.mockResolvedValue({ state: sampleState(), editKey: "k" });
      const { form } = setup();
      submit(form);
      await vi.waitFor(() => expect(createList).toHaveBeenCalledWith(""));
    });

    it("un échec affiche l'alerte exacte et réactive le bouton", async () => {
      createList.mockRejectedValue(new Error("réseau"));
      const { form, btn } = setup();
      submit(form);
      await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Impossible de créer la liste. Vérifie ta connexion internet."));
      expect(btn.disabled).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("consulter une liste", () => {
    const setup = () => {
      mountHomeView(root, navigate);
      return {
        form: root.querySelector("#join-form")!,
        input: root.querySelector("#join-code") as HTMLInputElement,
        error: root.querySelector("#join-error") as HTMLElement,
        btn: root.querySelector("#join-form button") as HTMLButtonElement,
      };
    };

    it("bloque l'envoi natif ; un code vide ne fait rien et masque l'erreur précédente", () => {
      const { form, input, error } = setup();
      error.hidden = false;
      input.value = "   ";
      const event = submit(form);
      expect(event.defaultPrevented).toBe(true);
      expect(error.hidden).toBe(true);
      expect(fetchListState).not.toHaveBeenCalled();
    });

    it("recadre et met en majuscules le code, désactive le bouton pendant l'appel, mémorise puis navigue", async () => {
      const call = deferred<ListState | null>();
      fetchListState.mockReturnValue(call.promise);
      const { form, input, btn } = setup();
      input.value = "  abc123 ";
      submit(form);
      expect(fetchListState).toHaveBeenCalledWith("ABC123");
      expect(btn.disabled).toBe(true);

      call.resolve(sampleState({ code: "ABC123", name: "Vue" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/l/ABC123"));
      expect(touchRecentList).toHaveBeenCalledWith("ABC123", "Vue");
      expect(btn.disabled).toBe(false);
    });

    it("un code inconnu affiche le message exact", async () => {
      fetchListState.mockResolvedValue(null);
      const { form, input, error } = setup();
      input.value = "zzz";
      submit(form);
      await vi.waitFor(() => expect(error.hidden).toBe(false));
      expect(error.textContent).toBe("Aucune liste ne correspond à ce code.");
      expect(navigate).not.toHaveBeenCalled();
    });

    it("une erreur réseau affiche le message dédié et réactive le bouton", async () => {
      fetchListState.mockRejectedValue(new Error("réseau"));
      const { form, input, error, btn } = setup();
      input.value = "abc";
      submit(form);
      await vi.waitFor(() => expect(error.hidden).toBe(false));
      expect(error.textContent).toBe("Erreur réseau, réessaie.");
      expect(btn.disabled).toBe(false);
    });
  });
});
