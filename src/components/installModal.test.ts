// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptInstall = vi.fn();
vi.mock("../lib/install", () => ({ promptInstall: (...a: unknown[]) => promptInstall(...a) }));
const release = vi.fn();
vi.mock("../lib/focusTrap", () => ({ trapFocus: () => release }));

import { installApp } from "./installModal";

describe("installApp", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    promptInstall.mockReset().mockResolvedValue(undefined);
    release.mockClear();
  });

  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  const manual = () => {
    installApp();
    (promptInstall.mock.calls[0][0] as () => void)();
    return document.querySelector(".modal-overlay") as HTMLElement;
  };

  it("délègue à l'invite d'installation, sans rien afficher tant que la marche manuelle n'est pas demandée", () => {
    installApp();
    expect(promptInstall).toHaveBeenCalledOnce();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("la marche manuelle (iPhone/iPad) affiche trois étapes et les icônes de Safari", () => {
    const overlay = manual();
    expect(overlay.querySelector("h2")!.textContent).toBe("Installer KesKeJeVoeux");
    expect(overlay.querySelector(".modal")!.getAttribute("aria-labelledby")).toBe("install-title");
    expect(overlay.querySelector("#install-title")).not.toBeNull();
    expect(overlay.querySelectorAll(".install-steps li")).toHaveLength(3);
    expect(overlay.querySelectorAll(".install-inline-icon svg")).toHaveLength(2);
  });

  it.each([["#install-ok"], [".modal-close"]])("%s ferme la modale et rend le focus", (selector) => {
    const overlay = manual();
    (overlay.querySelector(selector) as HTMLElement).click();
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("Échap ferme une seule fois ; une autre touche ne fait rien", () => {
    manual();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(document.querySelector(".modal-overlay")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("un clic sur le fond ferme, un clic dans la fenêtre non", () => {
    const overlay = manual();
    (overlay.querySelector(".modal") as HTMLElement).click();
    expect(document.querySelector(".modal-overlay")).not.toBeNull();
    overlay.click();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });
});
