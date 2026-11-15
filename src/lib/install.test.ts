// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module à état (invite différée, écouteurs) : ré-importé à neuf à chaque test.
async function load() {
  vi.resetModules();
  return import("./install");
}

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0, ...overrides });
}

function stubStandalone(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));
}

function installEvent(userChoice: Promise<{ outcome: string }> = Promise.resolve({ outcome: "accepted" })) {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = userChoice;
  return event;
}

describe("install", () => {
  const added: Array<[string, EventListener]> = [];

  beforeEach(() => {
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListener, options?: boolean) => {
      added.push([type, listener]);
      original(type, listener, options);
    }) as typeof window.addEventListener);
    stubStandalone(false);
    stubNavigator({});
  });

  afterEach(() => {
    for (const [type, l] of added.splice(0)) window.removeEventListener(type, l);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("isStandalone", () => {
    it("vrai en mode d'affichage « standalone »", async () => {
      stubStandalone(true);
      expect((await load()).isStandalone()).toBe(true);
      expect(window.matchMedia).toHaveBeenCalledWith("(display-mode: standalone)");
    });

    it("vrai pour la propriété navigator.standalone d'iOS", async () => {
      stubNavigator({ standalone: true });
      expect((await load()).isStandalone()).toBe(true);
    });

    it("faux sinon, et si matchMedia est absent", async () => {
      expect((await load()).isStandalone()).toBe(false);
      vi.stubGlobal("matchMedia", undefined);
      expect((await load()).isStandalone()).toBe(false);
    });
  });

  describe("isIos", () => {
    it.each([["iPhone"], ["iPad"], ["iPod"]])("reconnaît %s", async (name) => {
      stubNavigator({ userAgent: `Mozilla/5.0 (${name}; CPU OS 17_0)` });
      expect((await load()).isIos()).toBe(true);
    });

    it("reconnaît un iPad qui se présente comme un Mac tactile, pas un vrai Mac", async () => {
      stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 5 });
      expect((await load()).isIos()).toBe(true);
      stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 1 });
      expect((await load()).isIos()).toBe(false);
    });

    it("faux pour un autre système", async () => {
      expect((await load()).isIos()).toBe(false);
    });
  });

  describe("canOfferInstall", () => {
    it("faux par défaut", async () => {
      expect((await load()).canOfferInstall()).toBe(false);
    });

    it("vrai sur iOS, sauf si l'app est déjà installée", async () => {
      stubNavigator({ userAgent: "iPhone" });
      expect((await load()).canOfferInstall()).toBe(true);
      stubStandalone(true);
      expect((await load()).canOfferInstall()).toBe(false);
    });

    it("vrai une fois l'invite native reçue, sauf si déjà installée", async () => {
      const mod = await load();
      mod.initInstallPrompt();
      window.dispatchEvent(installEvent());
      expect(mod.canOfferInstall()).toBe(true);
      stubStandalone(true);
      expect(mod.canOfferInstall()).toBe(false);
    });
  });

  describe("invite native", () => {
    it("retient l'événement (sans laisser le navigateur l'afficher) et prévient les abonnés", async () => {
      const mod = await load();
      const listener = vi.fn();
      mod.onInstallAvailabilityChange(listener);
      mod.initInstallPrompt();
      const event = installEvent();

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
    });

    it("l'installation effective retire l'invite et prévient les abonnés", async () => {
      const mod = await load();
      mod.initInstallPrompt();
      window.dispatchEvent(installEvent());
      const listener = vi.fn();
      mod.onInstallAvailabilityChange(listener);

      window.dispatchEvent(new Event("appinstalled"));

      expect(listener).toHaveBeenCalledOnce();
      expect(mod.canOfferInstall()).toBe(false);
    });

    it("se désabonner arrête les notifications", async () => {
      const mod = await load();
      mod.initInstallPrompt();
      const listener = vi.fn();
      const off = mod.onInstallAvailabilityChange(listener);
      off();
      window.dispatchEvent(installEvent());
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("promptInstall", () => {
    it("sans invite native : déclenche la marche à suivre manuelle", async () => {
      const mod = await load();
      const onManual = vi.fn();
      await mod.promptInstall(onManual);
      expect(onManual).toHaveBeenCalledOnce();
    });

    it("avec invite native : l'affiche, attend le choix, prévient les abonnés, et ne la rejoue pas", async () => {
      const mod = await load();
      mod.initInstallPrompt();
      const event = installEvent();
      window.dispatchEvent(event);
      const listener = vi.fn();
      mod.onInstallAvailabilityChange(listener);
      const onManual = vi.fn();

      await mod.promptInstall(onManual);

      expect(event.prompt).toHaveBeenCalledOnce();
      expect(onManual).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalledOnce();
      expect(mod.canOfferInstall()).toBe(false);

      await mod.promptInstall(onManual);
      expect(event.prompt).toHaveBeenCalledOnce();
      expect(onManual).toHaveBeenCalledOnce();
    });

    it("tolère un choix utilisateur qui échoue", async () => {
      const mod = await load();
      mod.initInstallPrompt();
      window.dispatchEvent(installEvent(Promise.reject(new Error("abandon"))));
      const listener = vi.fn();
      mod.onInstallAvailabilityChange(listener);
      await expect(mod.promptInstall(vi.fn())).resolves.toBeUndefined();
      expect(listener).toHaveBeenCalledOnce();
    });
  });
});
