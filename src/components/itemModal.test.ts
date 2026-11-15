// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../../shared/types";
import { openItemModal, type ItemFormResult } from "./itemModal";

const prepareImage = vi.fn();
vi.mock("../lib/prepareImage", () => ({ prepareImage: (...a: unknown[]) => prepareImage(...a) }));
const release = vi.fn();
vi.mock("../lib/focusTrap", () => ({ trapFocus: () => release }));

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "i1",
    name: "Casque",
    description: "Noir",
    price: 49.9,
    link: "https://exemple.fr",
    imageUrl: "https://exemple.fr/i.jpg",
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Item;
}

describe("openItemModal", () => {
  let created: string[];
  let revoked: string[];
  let onSubmit: ReturnType<typeof vi.fn<(r: ItemFormResult) => void>>;

  const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
  const overlay = () => document.querySelector(".modal-overlay") as HTMLElement | null;
  const submit = () => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    $("#item-form").dispatchEvent(event);
    return event;
  };
  const choose = (file: File) => {
    Object.defineProperty($("#item-image-file"), "files", { value: [file], configurable: true });
    $("#item-image-file").dispatchEvent(new Event("change"));
  };
  const png = () => new File(["x"], "p.png", { type: "image/png" });

  beforeEach(() => {
    document.body.innerHTML = "";
    created = [];
    revoked = [];
    let n = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:${++n}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((u: string) => {
      revoked.push(u);
    }) as never;
    prepareImage.mockReset().mockImplementation(async () => new Blob(["ok"], { type: "image/jpeg" }));
    release.mockClear();
    onSubmit = vi.fn<(r: ItemFormResult) => void>();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  describe("création", () => {
    beforeEach(() => openItemModal({ onSubmit }));

    it("affiche un formulaire vide « Nouveau souhait », nom focalisé", () => {
      expect($("h2").textContent).toBe("Nouveau souhait");
      expect($(".modal").getAttribute("aria-labelledby")).toBe("item-modal-title");
      expect($("button[type=submit]").textContent).toBe("Ajouter");
      expect($<HTMLInputElement>("#item-name").value).toBe("");
      expect($<HTMLTextAreaElement>("#item-description").value).toBe("");
      expect($<HTMLInputElement>("#item-price").value).toBe("");
      expect($<HTMLInputElement>("#item-link").value).toBe("");
      expect($<HTMLInputElement>("#item-image-url").value).toBe("");
      expect(document.activeElement).toBe($("#item-name"));
      expect($("#image-preview").hidden).toBe(true);
      expect($("#image-preview").innerHTML).toBe("");
      expect($("#remove-image").hidden).toBe(true);
      expect($("#item-error").hidden).toBe(true);
      expect($("#image-error").hidden).toBe(true);
      expect($("#image-status").hidden).toBe(true);
    });

    it("un nom vide ou d'espaces est refusé, avec message et focus", () => {
      $<HTMLInputElement>("#item-name").value = "   ";
      $<HTMLInputElement>("#item-name").blur();
      const event = submit();
      expect(event.defaultPrevented).toBe(true);
      expect($("#item-error").textContent).toBe("Donne un nom à ce souhait.");
      expect($("#item-error").hidden).toBe(false);
      expect(document.activeElement).toBe($("#item-name"));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(overlay()).not.toBeNull();
    });

    it("un prix invalide est refusé, avec message et focus", () => {
      $<HTMLInputElement>("#item-name").value = "Casque";
      $<HTMLInputElement>("#item-price").value = "abc";
      submit();
      expect($("#item-error").textContent).toBe("Prix invalide (ex : 49,90).");
      expect($("#item-error").hidden).toBe(false);
      expect(document.activeElement).toBe($("#item-price"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("valide : transmet les champs recadrés, ferme et rend le focus", () => {
      $<HTMLInputElement>("#item-name").value = "  Casque  ";
      $<HTMLTextAreaElement>("#item-description").value = "  Noir  ";
      $<HTMLInputElement>("#item-price").value = "49,90";
      $<HTMLInputElement>("#item-link").value = "  https://exemple.fr  ";
      $<HTMLInputElement>("#item-image-url").value = "  https://exemple.fr/i.jpg  ";

      submit();

      expect(onSubmit).toHaveBeenCalledWith({
        name: "Casque",
        description: "Noir",
        link: "https://exemple.fr",
        imageUrl: "https://exemple.fr/i.jpg",
        price: 49.9,
        file: null,
        removeUploadedImage: false,
      });
      expect(overlay()).toBeNull();
      expect(release).toHaveBeenCalledOnce();
    });

    it("sans prix : null", () => {
      $<HTMLInputElement>("#item-name").value = "Casque";
      submit();
      expect(onSubmit.mock.calls[0][0].price).toBeNull();
    });

    it("l'URL d'image saisie s'affiche en aperçu (échappée), sans bouton « Retirer »", () => {
      const input = $<HTMLInputElement>("#item-image-url");
      input.value = '  https://x/"><b>.jpg ';
      input.dispatchEvent(new Event("input"));
      expect($("#image-preview").hidden).toBe(false);
      expect($("#image-preview img").getAttribute("src")).toBe('https://x/"><b>.jpg');
      expect($("#image-preview b")).toBeNull();
      expect($("#remove-image").hidden).toBe(true);

      input.value = "   ";
      input.dispatchEvent(new Event("input"));
      expect($("#image-preview").hidden).toBe(true);
      expect($("#image-preview").innerHTML).toBe("");
    });

    it("« Choisir une photo » ouvre le sélecteur de fichier", () => {
      const click = vi.spyOn($("#item-image-file"), "click").mockImplementation(() => {});
      $("#pick-image").click();
      expect(click).toHaveBeenCalledOnce();
      expect($("#item-image-file").getAttribute("accept")).toBe("image/*");
    });
  });

  describe("photo choisie", () => {
    beforeEach(() => openItemModal({ onSubmit }));

    it("pendant la préparation : bouton désactivé, statut affiché, envoi bloqué ; ensuite aperçu, « Retirer » et fichier transmis", async () => {
      let resolve!: (b: Blob) => void;
      prepareImage.mockReturnValue(new Promise<Blob>((r) => (resolve = r)));
      const picked = png();
      $<HTMLInputElement>("#item-name").value = "Casque";
      choose(picked);

      expect(prepareImage).toHaveBeenCalledWith(picked);
      expect($<HTMLButtonElement>("button[type=submit]").disabled).toBe(true);
      expect($("#image-status").hidden).toBe(false);
      expect($("#image-status").textContent).toBe("Préparation de la photo…");
      expect($<HTMLInputElement>("#item-image-file").value).toBe("");
      submit();
      expect(onSubmit).not.toHaveBeenCalled();

      const blob = new Blob(["ok"]);
      resolve(blob);
      await vi.waitFor(() => expect($<HTMLButtonElement>("button[type=submit]").disabled).toBe(false));
      expect($("#image-status").hidden).toBe(true);
      expect($("#image-preview img").getAttribute("src")).toBe("blob:1");
      expect($("#remove-image").hidden).toBe(false);

      submit();
      expect(onSubmit.mock.calls[0][0].file).toBe(blob);
    });

    it("annuler la sélection ne fait rien", () => {
      Object.defineProperty($("#item-image-file"), "files", { value: [], configurable: true });
      $("#item-image-file").dispatchEvent(new Event("change"));
      expect(prepareImage).not.toHaveBeenCalled();
      expect($("#image-status").hidden).toBe(true);
    });

    it("une seconde photo remplace la première (ancien aperçu révoqué)", async () => {
      choose(png());
      await vi.waitFor(() => expect($("#image-preview img")).not.toBeNull());
      choose(png());
      await vi.waitFor(() => expect($("#image-preview img").getAttribute("src")).toBe("blob:2"));
      expect(revoked).toEqual(["blob:1"]);
    });

    it("un échec affiche l'erreur sous la photo (message de l'erreur, ou message par défaut) et réactive l'envoi", async () => {
      prepareImage.mockRejectedValue(new Error("Format illisible"));
      choose(png());
      await vi.waitFor(() => expect($("#image-error").hidden).toBe(false));
      expect($("#image-error").textContent).toBe("Format illisible");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect($<HTMLButtonElement>("button[type=submit]").disabled).toBe(false);
      expect($("#image-status").hidden).toBe(true);
      expect($("#image-preview").hidden).toBe(true);

      prepareImage.mockRejectedValue(new Error(""));
      choose(png());
      await vi.waitFor(() => expect($("#image-error").textContent).toBe("Impossible de lire cette image."));
      prepareImage.mockRejectedValue("pas une Error");
      choose(png());
      await vi.waitFor(() => expect($("#image-error").textContent).toBe("Impossible de lire cette image."));
    });

    it("choisir une nouvelle photo masque l'erreur précédente", async () => {
      prepareImage.mockRejectedValueOnce(new Error("raté"));
      choose(png());
      await vi.waitFor(() => expect($("#image-error").hidden).toBe(false));
      choose(png());
      await vi.waitFor(() => expect($("#image-error").hidden).toBe(true));
    });

    it("« Retirer » supprime la photo choisie (aperçu révoqué), le champ URL reprend la main", async () => {
      $<HTMLInputElement>("#item-image-url").value = "https://exemple.fr/i.jpg";
      choose(png());
      await vi.waitFor(() => expect($("#remove-image").hidden).toBe(false));
      $("#remove-image").click();
      expect(revoked).toEqual(["blob:1"]);
      expect($("#image-preview img").getAttribute("src")).toBe("https://exemple.fr/i.jpg");
      expect($("#remove-image").hidden).toBe(true);
      $<HTMLInputElement>("#item-name").value = "x";
      submit();
      expect(onSubmit.mock.calls[0][0].file).toBeNull();
    });

    it("fermer sans photo choisie ne révoque rien", () => {
      $(".modal-close").click();
      expect(revoked).toEqual([]);
    });

    it("fermer révoque l'aperçu de la photo choisie", async () => {
      choose(png());
      await vi.waitFor(() => expect($("#remove-image").hidden).toBe(false));
      $(".modal-close").click();
      expect(revoked).toEqual(["blob:1"]);
    });
  });

  describe("modification", () => {
    it("préremplit tous les champs (prix avec virgule), titre et bouton dédiés", () => {
      openItemModal({ item: makeItem(), onSubmit });
      expect($("h2").textContent).toBe("Modifier le souhait");
      expect($("button[type=submit]").textContent).toBe("Enregistrer");
      expect($<HTMLInputElement>("#item-name").value).toBe("Casque");
      expect($<HTMLTextAreaElement>("#item-description").value).toBe("Noir");
      expect($<HTMLInputElement>("#item-price").value).toBe("49,9");
      expect($<HTMLInputElement>("#item-link").value).toBe("https://exemple.fr");
      expect($<HTMLInputElement>("#item-image-url").value).toBe("https://exemple.fr/i.jpg");
    });

    it("un prix à 0 est prérempli (« 0 »), un prix absent laisse le champ vide", () => {
      openItemModal({ item: makeItem({ price: 0 }), onSubmit });
      expect($<HTMLInputElement>("#item-price").value).toBe("0");
      document.body.innerHTML = "";
      openItemModal({ item: makeItem({ price: undefined, description: undefined, link: undefined, imageUrl: undefined }), onSubmit });
      expect($<HTMLInputElement>("#item-price").value).toBe("");
      expect($<HTMLTextAreaElement>("#item-description").value).toBe("");
      expect($<HTMLInputElement>("#item-link").value).toBe("");
    });

    it("échappe les valeurs préremplies", () => {
      openItemModal({ item: makeItem({ name: '"><b>x</b>', description: "</textarea><i>" }), onSubmit });
      expect($("#item-form b")).toBeNull();
      expect($("#item-form i")).toBeNull();
      expect($<HTMLInputElement>("#item-name").value).toBe('"><b>x</b>');
      expect($<HTMLTextAreaElement>("#item-description").value).toBe("</textarea><i>");
    });

    it("affiche la photo déjà envoyée, avec « Retirer » ; la retirer le signale à l'envoi", () => {
      openItemModal({ item: makeItem({ imageUrl: undefined }), uploadedImageSrc: "/img/1?v=2", onSubmit });
      expect($("#image-preview img").getAttribute("src")).toBe("/img/1?v=2");
      expect($("#remove-image").hidden).toBe(false);

      $("#remove-image").click();
      expect($("#image-preview").hidden).toBe(true);
      expect($("#remove-image").hidden).toBe(true);
      submit();
      expect(onSubmit.mock.calls[0][0].removeUploadedImage).toBe(true);
    });

    it("sans retrait, removeUploadedImage reste faux ; la photo envoyée prime sur l'URL saisie", () => {
      openItemModal({ item: makeItem(), uploadedImageSrc: "/img/1?v=2", onSubmit });
      expect($("#image-preview img").getAttribute("src")).toBe("/img/1?v=2");
      submit();
      expect(onSubmit.mock.calls[0][0].removeUploadedImage).toBe(false);
    });
  });

  describe("fermeture", () => {
    beforeEach(() => openItemModal({ onSubmit }));

    it.each([[".modal-close"], ["#item-cancel"]])("%s ferme sans envoyer et rend le focus", (selector) => {
      $(selector).click();
      expect(overlay()).toBeNull();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
    });

    it("Échap ferme une seule fois ; une autre touche ne fait rien", () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(overlay()).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(overlay()).toBeNull();
      expect(release).toHaveBeenCalledOnce();
    });

    it("un clic sur le fond ferme, un clic dans la fenêtre non", () => {
      $(".modal").click();
      expect(overlay()).not.toBeNull();
      overlay()!.click();
      expect(overlay()).toBeNull();
    });
  });
});
