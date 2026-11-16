// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Navigate = (path: string, replace?: boolean) => void;
let capturedNavigate: Navigate | undefined;

const cleanupHome = vi.fn();
const cleanupList = vi.fn();
const mountHomeView = vi.fn((_root: HTMLElement, navigate: Navigate) => {
  capturedNavigate = navigate;
  return cleanupHome;
});
const mountListView = vi.fn((_root: HTMLElement, _code: string, _opts: { preview: boolean }, navigate: Navigate) => {
  capturedNavigate = navigate;
  return cleanupList;
});
const initInstallPrompt = vi.fn();

vi.mock("./views/home", () => ({ mountHomeView: (...a: Parameters<typeof mountHomeView>) => mountHomeView(...a) }));
vi.mock("./views/list", () => ({ mountListView: (...a: Parameters<typeof mountListView>) => mountListView(...a) }));
vi.mock("./lib/install", () => ({ initInstallPrompt: () => initInstallPrompt() }));

// Enregistrement du service worker et bandeaux PWA : remplacés par des espions
// (le module « virtual:pwa-register » n'existe que dans un build Vite).
const applyUpdate = vi.fn(async () => {});
const registerSW = vi.fn((_options: { onNeedRefresh: () => void }) => applyUpdate);
const showUpdateBanner = vi.fn();
const watchOffline = vi.fn();
vi.mock("virtual:pwa-register", () => ({ registerSW: (...a: Parameters<typeof registerSW>) => registerSW(...a) }));
vi.mock("./components/pwaBanner", () => ({
  showUpdateBanner: (...a: Parameters<typeof showUpdateBanner>) => showUpdateBanner(...a),
  watchOffline: () => watchOffline(),
}));

// main.ts est un point d'entrée à effets de bord : chaque test le ré-importe à
// neuf (resetModules) et retire l'écouteur popstate qu'il a posé sur window.
const popstateListeners: EventListener[] = [];
const KEY = "0123456789abcdef0123456789abcdef";

async function boot(url: string): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, "", url);
  vi.resetModules();
  await import("./main");
  return document.getElementById("app")!;
}

async function editKeyOf(code: string): Promise<string | null> {
  const { getEditKey } = await import("./lib/storage");
  return getEditKey(code);
}

describe("main (bootstrap applicatif)", () => {
  beforeEach(() => {
    registerSW.mockClear();
    applyUpdate.mockClear();
    showUpdateBanner.mockClear();
    watchOffline.mockClear();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-large-text");
    for (const fn of [mountHomeView, mountListView, cleanupHome, cleanupList, initInstallPrompt]) fn.mockClear();
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListener, options?: unknown) => {
      if (type === "popstate") popstateListeners.push(listener);
      original(type, listener, options as boolean);
    }) as typeof window.addEventListener);
  });

  afterEach(() => {
    for (const l of popstateListeners.splice(0)) window.removeEventListener("popstate", l);
    vi.restoreAllMocks();
  });

  it("applique thème et accessibilité enregistrés, et prépare l'invite d'installation, avant le premier rendu", async () => {
    localStorage.setItem("kkjv:theme", "dark");
    localStorage.setItem("kkjv:a11y", JSON.stringify({ largeText: true, highContrast: false, reduceMotion: false }));
    await boot("/");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.hasAttribute("data-large-text")).toBe(true);
    expect(initInstallPrompt).toHaveBeenCalledOnce();
  });

  it("monte l'accueil sur « / »", async () => {
    const app = await boot("/");
    expect(mountHomeView).toHaveBeenCalledTimes(1);
    expect(mountHomeView).toHaveBeenCalledWith(app, expect.any(Function));
    expect(mountListView).not.toHaveBeenCalled();
  });

  it("monte la liste sur « /l/code » (majuscules), avec ou sans slash final, en lecture par défaut", async () => {
    const app = await boot("/l/abc123");
    expect(mountListView).toHaveBeenCalledWith(app, "ABC123", { preview: false }, expect.any(Function));
    await boot("/l/abc123/");
    expect(mountListView).toHaveBeenLastCalledWith(app, "ABC123", { preview: false }, expect.any(Function));
    expect(mountHomeView).not.toHaveBeenCalled();
  });

  it.each([["/autre/l/abc"], ["/l/abc/suite"], ["/l/"], ["/l/a-b"]])("%s n'est pas une liste : monte l'accueil", async (url) => {
    await boot(url);
    expect(mountListView).not.toHaveBeenCalled();
    expect(mountHomeView).toHaveBeenCalledTimes(1);
  });

  it("« ?lecture » active l'aperçu invité", async () => {
    const app = await boot("/l/abc123?lecture");
    expect(mountListView).toHaveBeenCalledWith(app, "ABC123", { preview: true }, expect.any(Function));
    await boot("/l/abc123?autre=1");
    expect(mountListView).toHaveBeenLastCalledWith(app, "ABC123", { preview: false }, expect.any(Function));
  });

  describe("lien d'édition (#cle=…)", () => {
    it("mémorise la clé valide et retire le fragment de l'URL (chemin et query conservés)", async () => {
      const replace = vi.spyOn(history, "replaceState");
      await boot(`/l/abc123?lecture#cle=${KEY}`);
      expect(await editKeyOf("ABC123")).toBe(KEY);
      expect(location.hash).toBe("");
      expect(replace).toHaveBeenCalledWith({}, "", "/l/abc123?lecture");
    });

    it("un fragment invalide est retiré sans rien mémoriser", async () => {
      await boot("/l/abc123#cle=pasunecle");
      expect(await editKeyOf("ABC123")).toBeNull();
      expect(localStorage.getItem("kkjv:editKeys")).toBeNull();
      expect(location.hash).toBe("");
    });

    it("sans fragment, l'URL n'est pas touchée", async () => {
      document.body.innerHTML = '<div id="app"></div>';
      history.replaceState({}, "", "/l/abc123");
      const replace = vi.spyOn(history, "replaceState");
      vi.resetModules();
      await import("./main");
      expect(replace).not.toHaveBeenCalled();
      expect(await editKeyOf("ABC123")).toBeNull();
    });

    it("n'est consommé que sur une liste, pas sur l'accueil", async () => {
      await boot(`/#cle=${KEY}`);
      expect(location.hash).toBe(`#cle=${KEY}`);
    });
  });

  describe("navigation", () => {
    it("pousse l'historique, nettoie la vue précédente et monte la suivante", async () => {
      const app = await boot("/");
      const push = vi.spyOn(history, "pushState");
      const replace = vi.spyOn(history, "replaceState");

      capturedNavigate!("/l/abcdef");

      expect(push).toHaveBeenCalledWith({}, "", "/l/abcdef");
      expect(replace).not.toHaveBeenCalled();
      expect(cleanupHome).toHaveBeenCalledOnce();
      expect(mountListView).toHaveBeenCalledWith(app, "ABCDEF", { preview: false }, expect.any(Function));
    });

    it("en mode « remplacer », n'ajoute pas d'entrée d'historique", async () => {
      await boot("/l/abcdef");
      const push = vi.spyOn(history, "pushState");
      const replace = vi.spyOn(history, "replaceState");
      capturedNavigate!("/", true);
      expect(replace).toHaveBeenCalledWith({}, "", "/");
      expect(push).not.toHaveBeenCalled();
      expect(cleanupList).toHaveBeenCalledOnce();
      expect(mountHomeView).toHaveBeenCalledOnce();
    });

    it("vers le chemin courant (query comprise), ne touche pas l'historique mais re-rend", async () => {
      await boot("/l/abcdef?lecture");
      const push = vi.spyOn(history, "pushState");
      const replace = vi.spyOn(history, "replaceState");
      capturedNavigate!("/l/abcdef?lecture");
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(mountListView).toHaveBeenCalledTimes(2);
    });

    it("sur la même page mais avec une query différente, pousse l'historique", async () => {
      await boot("/l/abcdef?lecture");
      const push = vi.spyOn(history, "pushState");
      capturedNavigate!("/l/abcdef");
      expect(push).toHaveBeenCalledWith({}, "", "/l/abcdef");
    });

    it("popstate re-rend selon le chemin courant", async () => {
      const app = await boot("/");
      history.replaceState({}, "", "/l/zzzzzz");
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(cleanupHome).toHaveBeenCalledOnce();
      expect(mountListView).toHaveBeenCalledWith(app, "ZZZZZZ", { preview: false }, expect.any(Function));
    });
  });

  describe("PWA", () => {
    it("surveille l'état hors ligne au démarrage", async () => {
      await boot("/");
      expect(watchOffline).toHaveBeenCalledTimes(1);
    });

    it("enregistre le service worker et annonce une nouvelle version sans recharger", async () => {
      await boot("/");
      expect(registerSW).toHaveBeenCalledTimes(1);
      expect(showUpdateBanner).not.toHaveBeenCalled();
      registerSW.mock.calls[0][0].onNeedRefresh();
      expect(showUpdateBanner).toHaveBeenCalledTimes(1);
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    it("recharge avec la nouvelle version quand l'utilisateur accepte", async () => {
      await boot("/");
      registerSW.mock.calls[0][0].onNeedRefresh();
      (showUpdateBanner.mock.calls[0][0] as () => void)();
      expect(applyUpdate).toHaveBeenCalledWith(true);
    });
  });
});
