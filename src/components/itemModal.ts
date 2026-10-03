import type { Item } from "../../shared/types";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../../shared/types";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { parsePriceInput } from "../lib/price";

export interface ItemFormResult {
  name: string;
  description: string;
  link: string;
  imageUrl: string;
  price: number | null;
  /** Nouvelle photo à envoyer, le cas échéant. */
  file: File | null;
  /** L'utilisateur a retiré la photo déjà envoyée. */
  removeUploadedImage: boolean;
}

export interface ItemModalOptions {
  item?: Item;
  /** URL de la photo déjà envoyée pour ce souhait, le cas échéant. */
  uploadedImageSrc?: string | null;
  onSubmit: (result: ItemFormResult) => void;
}

/** Formulaire d'ajout / de modification d'un souhait : nom, description,
 * prix, lien, et une image (photo envoyée, ou URL d'une image en ligne). */
export function openItemModal(opts: ItemModalOptions): void {
  const { item } = opts;
  let file: File | null = null;
  let filePreviewUrl: string | null = null;
  let uploadedSrc = opts.uploadedImageSrc ?? null;
  let removeUploadedImage = false;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title" tabindex="-1">
      <button type="button" class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2 id="item-modal-title">${item ? "Modifier le souhait" : "Nouveau souhait"}</h2>
      <form id="item-form" class="item-form" novalidate>
        <label class="field">
          <span>Nom</span>
          <input id="item-name" type="text" maxlength="200" required value="${escapeHtml(item?.name ?? "")}" placeholder="Ex : Casque audio" />
        </label>
        <label class="field">
          <span>Description <small>(optionnel)</small></span>
          <textarea id="item-description" rows="3" maxlength="2000" placeholder="Taille, couleur, modèle…">${escapeHtml(item?.description ?? "")}</textarea>
        </label>
        <label class="field">
          <span>Prix <small>(optionnel, en €)</small></span>
          <input id="item-price" type="text" inputmode="decimal" value="${item?.price !== undefined ? String(item.price).replace(".", ",") : ""}" placeholder="Ex : 49,90" />
        </label>
        <label class="field">
          <span>Lien <small>(optionnel)</small></span>
          <input id="item-link" type="url" maxlength="2000" value="${escapeHtml(item?.link ?? "")}" placeholder="https://…" />
        </label>
        <fieldset class="field image-field">
          <legend>Image <small>(optionnel)</small></legend>
          <div class="image-preview" id="image-preview"></div>
          <div class="image-actions">
            <button type="button" class="btn" id="pick-image">${icons.image} Choisir une photo</button>
            <button type="button" class="btn" id="remove-image" hidden>${icons.trash} Retirer</button>
          </div>
          <input id="item-image-file" type="file" accept="${ALLOWED_IMAGE_TYPES.join(",")}" hidden />
          <label class="field sub-field">
            <span>ou l'adresse d'une image en ligne</span>
            <input id="item-image-url" type="url" maxlength="2000" value="${escapeHtml(item?.imageUrl ?? "")}" placeholder="https://…/image.jpg" />
          </label>
        </fieldset>
        <p class="error" id="item-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" id="item-cancel">Annuler</button>
          <button type="submit" class="btn primary">${item ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = <T extends HTMLElement>(sel: string) => overlay.querySelector(sel) as T;
  const nameInput = $<HTMLInputElement>("#item-name");
  const priceInput = $<HTMLInputElement>("#item-price");
  const imageUrlInput = $<HTMLInputElement>("#item-image-url");
  const fileInput = $<HTMLInputElement>("#item-image-file");
  const preview = $<HTMLElement>("#image-preview");
  const removeBtn = $<HTMLButtonElement>("#remove-image");
  const errorEl = $<HTMLElement>("#item-error");

  function renderPreview(): void {
    const src = filePreviewUrl ?? uploadedSrc ?? (imageUrlInput.value.trim() || null);
    preview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="" />` : "";
    preview.hidden = !src;
    removeBtn.hidden = !(filePreviewUrl || uploadedSrc);
  }
  renderPreview();

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  $("#pick-image").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const picked = fileInput.files?.[0];
    fileInput.value = "";
    if (!picked) return;
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(picked.type)) {
      showError("Format d'image non supporté (PNG, JPEG, WebP ou GIF).");
      return;
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      showError("Image trop volumineuse (5 Mo max).");
      return;
    }
    errorEl.hidden = true;
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    file = picked;
    filePreviewUrl = URL.createObjectURL(picked);
    renderPreview();
  });
  removeBtn.addEventListener("click", () => {
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      filePreviewUrl = null;
      file = null;
    } else if (uploadedSrc) {
      uploadedSrc = null;
      removeUploadedImage = true;
    }
    renderPreview();
  });
  imageUrlInput.addEventListener("input", renderPreview);

  const releaseFocusTrap = trapFocus($(".modal"));
  nameInput.focus();

  function close(): void {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    releaseFocusTrap();
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  $(".modal-close").addEventListener("click", close);
  $("#item-cancel").addEventListener("click", close);

  $<HTMLFormElement>("#item-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      showError("Donne un nom à ce souhait.");
      nameInput.focus();
      return;
    }
    const price = parsePriceInput(priceInput.value);
    if (price === undefined) {
      showError("Prix invalide (ex : 49,90).");
      priceInput.focus();
      return;
    }
    const result: ItemFormResult = {
      name,
      description: $<HTMLTextAreaElement>("#item-description").value.trim(),
      link: $<HTMLInputElement>("#item-link").value.trim(),
      imageUrl: imageUrlInput.value.trim(),
      price,
      file,
      removeUploadedImage,
    };
    close();
    opts.onSubmit(result);
  });
}
