// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openShareModal } from "./shareModal";

vi.mock("./qr", () => ({
  renderQrSvg: vi.fn(async (text: string) => `<svg data-text="${text}"></svg>`),
}));

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const stray = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "");

describe("openShareModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>).clipboard;
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  const overlay = () => document.querySelector(".modal-overlay") as HTMLElement;

  it("affiche le code, le nom (échappé) et le lien de lecture seule", () => {
    openShareModal("ABCDEF", "<b>Noël</b>", null);
    expect(overlay().querySelector("h2")!.textContent).toBe("Partager « <b>Noël</b> »");
    expect(overlay().querySelector("h2 b")).toBeNull();
    expect(overlay().querySelector(".share-code")!.textContent).toBe("ABCDEF");
    expect(overlay().querySelector("#share-read-url")!.textContent).toContain("/l/ABCDEF");
    expect(overlay().querySelector(".modal")!.getAttribute("aria-labelledby")).toBe("share-title");
  });

  it("génère le QR code du lien de lecture", async () => {
    openShareModal("ABCDEF", "Noël", null);
    await flushPromises();
    const url = overlay().querySelector("#share-read-url")!.textContent;
    expect(overlay().querySelector("#qr-wrap")!.innerHTML).toContain(`data-text="${url}"`);
  });

  it("sans clé d'édition : pas de lien d'édition ; avec : lien replié, lisible et copiable", async () => {
    openShareModal("ABCDEF", "Noël", null);
    expect(overlay().querySelector(".edit-link-box")).toBeNull();
    document.body.innerHTML = "";

    openShareModal("ABCDEF", "Noël", "ma-clé");
    const box = overlay().querySelector("details.edit-link-box") as HTMLDetailsElement;
    expect(box.open).toBe(false);
    const editUrl = overlay().querySelector("#share-edit-url")!.textContent!;
    expect(editUrl).toContain("/l/ABCDEF");
    expect(editUrl).toContain("ma-clé");

    const btn = overlay().querySelector("#copy-edit-link") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(editUrl);
    expect(btn.textContent).toBe("Copié !");
    vi.advanceTimersByTime(1200);
    expect(btn.textContent).toBe("Copier le lien d'édition");
  });

  it("copie le lien de lecture avec une confirmation temporaire, même si la copie échoue", async () => {
    openShareModal("ABCDEF", "Noël", null);
    const btn = overlay().querySelector("#copy-link") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(overlay().querySelector("#share-read-url")!.textContent);
    expect(btn.textContent).toBe("Copié !");
    vi.advanceTimersByTime(1200);
    expect(btn.textContent).toBe("Copier le lien");

    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));
    btn.click();
    await flushPromises();
    expect(btn.textContent).toBe("Copié !");
  });

  it("sans partage natif : un seul bouton ; avec : partage et ignore une annulation", async () => {
    openShareModal("ABCDEF", "Noël", null);
    expect(overlay().querySelector("#native-share")).toBeNull();
    expect(overlay().querySelector(".share-actions")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Copier le lien");
    expect(stray(overlay().querySelector(".share-actions")!)).toEqual([]);
    document.body.innerHTML = "";

    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    openShareModal("ABCDEF", "Noël", null);
    (overlay().querySelector("#native-share") as HTMLButtonElement).click();
    await flushPromises();
    expect(share).toHaveBeenCalledWith({ title: "Noël", url: overlay().querySelector("#share-read-url")!.textContent });
    share.mockRejectedValue(new Error("AbortError"));
    (overlay().querySelector("#native-share") as HTMLButtonElement).click();
    await flushPromises();
    expect(overlay()).not.toBeNull();
  });

  it("sans clé d'édition, la modale n'a aucun texte parasite", () => {
    openShareModal("ABCDEF", "Noël", null);
    expect(stray(overlay().querySelector(".modal")!)).toEqual([]);
  });

  it("ferme : bouton (focus rendu), Échap une seule fois, fond mais pas fenêtre", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const remove = vi.spyOn(document, "removeEventListener");
    openShareModal("ABCDEF", "Noël", null);
    (overlay().querySelector(".modal") as HTMLElement).click();
    expect(overlay()).not.toBeNull();
    (overlay().querySelector(".modal-close") as HTMLElement).click();
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(remove.mock.calls.map(([t]) => t)).toContain("keydown");
    expect(document.activeElement).toBe(outside);

    openShareModal("ABCDEF", "Noël", null);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(document.querySelector(".modal-overlay")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".modal-overlay")).toBeNull();

    openShareModal("ABCDEF", "Noël", null);
    overlay().click();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });
});
