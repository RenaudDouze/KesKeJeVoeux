import type { Item, ListState } from "../../shared/types";
import { ListConnection } from "../lib/ws";
import { deleteItemImage, fetchListState, itemImageUrl, uploadItemImage } from "../lib/http";
import { cacheListState, forgetEditKey, getCachedListState, getEditKey, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { wireConfirmClick } from "../lib/confirmClick";
import { enableDragReorder } from "../lib/dnd";
import { formatPrice, totalPrice } from "../lib/price";
import { uploadErrorMessage } from "../lib/imageSize";
import { cycleThemePreference, getThemePreference, themeLabel } from "../lib/theme";
import { openShareModal } from "../components/shareModal";
import { openItemModal, type ItemFormResult } from "../components/itemModal";
import { openAccessibilityModal } from "../components/accessibilityModal";
import { installApp } from "../components/installModal";
import { canOfferInstall } from "../lib/install";

const UNDO_TIMEOUT_MS = 5000;
/** Une erreur reste affichée plus longtemps, et se ferme à la main. */
const ERROR_TOAST_MS = 12000;

function presenceLabel(count: number): string {
  return count <= 1 ? `${count} personne connectée` : `${count} personnes connectées`;
}

/** Nom de domaine affiché pour un lien (plus lisible que l'URL complète). */
function linkLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/** Image en plein écran (clic sur une miniature), fermée au clic, sur
 * Échap ou sur le bouton fermer. */
function openImageLightbox(url: string, alt: string): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay image-lightbox-overlay";
  overlay.innerHTML = `
    <button type="button" class="icon-btn image-lightbox-close" aria-label="Fermer">${icons.close}</button>
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="image-lightbox-img" />
  `;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  };
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
}

export function mountListView(
  root: HTMLElement,
  code: string,
  opts: { preview: boolean },
  navigate: (path: string) => void,
): () => void {
  // Clé d'édition connue de cet appareil. En aperçu (?lecture), on ne
  // l'envoie pas du tout : le serveur nous traite exactement comme un invité.
  const storedKey = getEditKey(code);
  const editKey = opts.preview ? null : storedKey;
  let canEdit = editKey !== null;
  let state: ListState | null = getCachedListState(code);
  let connected = false;
  let presence = 0;
  let notFound = false;
  let loadError = false;
  let dragging = false;
  let renderPending = false;
  let disposeDnd: (() => void) | null = null;
  // Photos choisies pour un souhait tout juste ajouté : envoyées dès que le
  // souhait existe côté serveur (l'upload échouerait silencieusement avant).
  const pendingUploads = new Map<string, Blob>();
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  const conn = new ListConnection(code, editKey);

  root.innerHTML = `
    <div class="list-view">
      <header class="list-header">
        <button type="button" class="icon-btn" id="btn-back" aria-label="Accueil" title="Accueil">${icons.back}</button>
        <div class="list-title-wrap">
          <h1 class="list-title" id="list-title"></h1>
          <span class="conn-dot" id="conn-dot" aria-hidden="true"></span>
        </div>
        <span class="presence" id="presence" role="status" title="Personnes connectées">${icons.users}<span id="presence-count">0</span></span>
        <button type="button" class="icon-btn" id="btn-share" aria-label="Partager" title="Partager">${icons.share}</button>
        <div class="menu-wrap">
          <button type="button" class="icon-btn" id="btn-menu" aria-label="Menu" aria-haspopup="true" aria-expanded="false">${icons.more}</button>
          <div class="menu" id="menu" role="menu" hidden></div>
        </div>
      </header>
      <div class="mode-banner" id="mode-banner" hidden></div>
      <main class="list-main">
        <p class="state-message" id="state-message" hidden></p>
        <ul class="wishes" id="wishes"></ul>
        <p class="total" id="total" hidden></p>
      </main>
      <button type="button" class="btn primary add-wish" id="btn-add" hidden>${icons.plus} Ajouter un souhait</button>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const wishesEl = $<HTMLUListElement>("#wishes");

  // ---------- Rendu ----------

  function imageSrc(item: Item): string | null {
    if (item.hasImage) return itemImageUrl(code, item.id, item.imageVersion);
    return item.imageUrl || null;
  }

  function wishHtml(item: Item): string {
    const src = imageSrc(item);
    const name = escapeHtml(item.name);
    return `
      <li class="wish" data-id="${escapeHtml(item.id)}">
        ${canEdit ? `<button type="button" class="wish-handle icon-btn" aria-label="Déplacer « ${name} »" title="Glisser pour déplacer">${icons.gripVertical}</button>` : ""}
        <div class="wish-media">
          ${
            src
              ? `<button type="button" class="wish-image-btn" aria-label="Agrandir l'image de « ${name} »"><img class="wish-image" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></button>`
              : `<span class="wish-placeholder" aria-hidden="true">${icons.gift}</span>`
          }
        </div>
        <div class="wish-body">
          <div class="wish-heading">
            <h3 class="wish-name">${name}</h3>
            ${item.price !== undefined ? `<span class="wish-price">${formatPrice(item.price)}</span>` : ""}
          </div>
          ${item.description ? `<p class="wish-description">${escapeHtml(item.description)}</p>` : ""}
          ${
            item.link
              ? `<a class="wish-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${icons.externalLink}<span>${escapeHtml(linkLabel(item.link))}</span></a>`
              : ""
          }
        </div>
        ${
          canEdit
            ? `<div class="wish-actions">
                <button type="button" class="icon-btn wish-edit" aria-label="Modifier « ${name} »" title="Modifier">${icons.edit}</button>
                <button type="button" class="icon-btn wish-delete" aria-label="Supprimer « ${name} »" title="Supprimer">${icons.trash}</button>
              </div>`
            : ""
        }
      </li>`;
  }

  function renderHeader(): void {
    const title = $<HTMLElement>("#list-title");
    title.textContent = state?.name ?? (notFound ? "Liste introuvable" : "Chargement…");
    title.classList.toggle("editable", canEdit);
    title.tabIndex = canEdit ? 0 : -1;
    title.title = canEdit ? "Cliquer pour renommer" : "";
    $<HTMLElement>("#conn-dot").classList.toggle("online", connected);
    $<HTMLElement>("#conn-dot").title = connected ? "Connecté" : "Hors ligne";
    $<HTMLElement>("#presence-count").textContent = String(presence);
    $<HTMLElement>("#presence").setAttribute("aria-label", presenceLabel(presence));
    $<HTMLElement>("#presence").hidden = !connected;
    $<HTMLElement>("#btn-share").hidden = !state;
    $<HTMLElement>("#btn-add").hidden = !canEdit || !state;

    const banner = $<HTMLElement>("#mode-banner");
    banner.hidden = canEdit || !state;
    if (!canEdit && state) {
      banner.innerHTML = `
        <span class="mode-banner-text">${icons.eye} <strong>Mode lecture</strong></span>
        <span class="mode-banner-presence" id="banner-presence">${connected ? presenceLabel(presence) : "Hors ligne"}</span>
        ${opts.preview && storedKey ? '<button type="button" class="btn small" id="btn-exit-preview">Revenir à l\'édition</button>' : ""}
      `;
      banner.querySelector("#btn-exit-preview")?.addEventListener("click", () => navigate(`/l/${code}`));
    }
  }

  function renderItems(): void {
    if (dragging) {
      renderPending = true;
      return;
    }
    const message = $<HTMLElement>("#state-message");
    const totalEl = $<HTMLElement>("#total");
    if (!state) {
      wishesEl.innerHTML = "";
      totalEl.hidden = true;
      message.hidden = false;
      message.textContent = notFound
        ? "Aucune liste ne correspond à ce code."
        : loadError
          ? "Impossible de charger la liste. Vérifie ta connexion."
          : "Chargement…";
      return;
    }
    const items = [...state.items].sort((a, b) => a.order - b.order);
    message.hidden = items.length > 0;
    message.textContent = canEdit ? "Ta liste est vide. Ajoute ton premier souhait !" : "Cette liste est vide pour l'instant.";
    wishesEl.innerHTML = items.map(wishHtml).join("");
    const total = totalPrice(items);
    totalEl.hidden = total === null;
    totalEl.textContent = total === null ? "" : `Total : ${formatPrice(total)}`;
    wireItemActions();
  }

  function render(): void {
    renderHeader();
    renderItems();
  }

  // ---------- Actions sur les souhaits ----------

  function findItem(id: string): Item | undefined {
    return state?.items.find((i) => i.id === id);
  }

  function wireItemActions(): void {
    wishesEl.querySelectorAll<HTMLElement>(".wish").forEach((li) => {
      const id = li.dataset.id!;
      li.querySelector(".wish-image-btn")?.addEventListener("click", () => {
        const item = findItem(id);
        const src = item && imageSrc(item);
        if (item && src) openImageLightbox(src, item.name);
      });
      if (!canEdit) return;
      li.querySelector(".wish-edit")?.addEventListener("click", () => editItem(id));
      const del = li.querySelector<HTMLButtonElement>(".wish-delete");
      if (del) {
        wireConfirmClick(del, { armedLabel: "Confirmer la suppression", onConfirm: () => deleteItem(id) });
      }
    });
  }

  function addItem(): void {
    openItemModal({
      onSubmit: (result) => {
        const id = uid();
        conn.send({
          type: "addItem",
          id,
          name: result.name,
          description: result.description,
          link: result.link,
          imageUrl: result.imageUrl,
          price: result.price ?? undefined,
        });
        if (result.file) {
          pendingUploads.set(id, result.file);
          showToast("Envoi de la photo…", undefined, 0);
          flushPendingUploads();
        }
      },
    });
  }

  function editItem(id: string): void {
    const item = findItem(id);
    if (!item) return;
    openItemModal({
      item,
      uploadedImageSrc: item.hasImage ? itemImageUrl(code, item.id, item.imageVersion) : null,
      onSubmit: (result: ItemFormResult) => {
        conn.send({
          type: "updateItem",
          id,
          name: result.name,
          description: result.description,
          link: result.link,
          imageUrl: result.imageUrl,
          price: result.price,
        });
        if (!editKey) return;
        if (result.file) {
          sendImage(id, result.file);
        } else if (result.removeUploadedImage) {
          deleteItemImage(code, id, editKey).catch((err: unknown) =>
            showToast(err instanceof Error ? err.message : "Impossible de retirer la photo.", undefined, ERROR_TOAST_MS),
          );
        }
      },
    });
  }

  function deleteItem(id: string): void {
    const item = findItem(id);
    if (!item) return;
    const snapshot = structuredClone(item);
    conn.send({ type: "deleteItem", id });
    showToast(`« ${item.name} » supprimé`, () => conn.send({ type: "restoreItem", item: snapshot }));
  }

  function flushPendingUploads(): void {
    if (!state || !editKey) return;
    for (const [id, file] of pendingUploads) {
      if (!findItem(id)) continue;
      pendingUploads.delete(id);
      sendImage(id, file);
    }
  }

  /** Envoie une photo en signalant toujours le résultat : un échec ne doit
   * jamais passer inaperçu (sinon le souhait reste simplement sans photo). */
  function sendImage(id: string, blob: Blob): void {
    if (!editKey) return;
    showToast("Envoi de la photo…", undefined, 0);
    uploadItemImage(code, id, blob, editKey)
      .then(() => showToast("Photo enregistrée"))
      .catch((err: unknown) => showToast(uploadErrorMessage(err), undefined, ERROR_TOAST_MS));
  }

  // ---------- Toast (erreurs, annulation) ----------

  /** `durationMs` : 0 = reste affiché jusqu'au prochain message (ex : envoi
   * en cours). Les erreurs (ERROR_TOAST_MS) ont un bouton de fermeture. */
  function showToast(text: string, undo?: () => void, durationMs: number = UNDO_TIMEOUT_MS): void {
    document.getElementById("toast")?.remove();
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    const isError = durationMs === ERROR_TOAST_MS;
    const toast = document.createElement("div");
    toast.id = "toast";
    toast.className = isError ? "toast toast-error" : "toast";
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.innerHTML = `<span>${escapeHtml(text)}</span>${undo ? '<button type="button" class="btn small" id="toast-undo">Annuler</button>' : ""}${
      isError ? `<button type="button" class="icon-btn" id="toast-close" aria-label="Fermer">${icons.close}</button>` : ""
    }`;
    document.body.appendChild(toast);
    toast.querySelector("#toast-undo")?.addEventListener("click", () => {
      undo?.();
      toast.remove();
    });
    toast.querySelector("#toast-close")?.addEventListener("click", () => toast.remove());
    if (durationMs > 0) undoTimer = setTimeout(() => toast.remove(), durationMs);
  }

  // ---------- Renommage de la liste ----------

  function startRename(): void {
    if (!canEdit || !state) return;
    const title = $<HTMLElement>("#list-title");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-edit list-title-input";
    input.maxLength = 200;
    input.value = state.name;
    input.setAttribute("aria-label", "Nom de la liste");
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.replaceWith(title);
      if (commit && name && state && name !== state.name) {
        state.name = name;
        conn.send({ type: "renameList", name });
      }
      renderHeader();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  // ---------- Menu ----------

  function renderMenu(): void {
    const menu = $<HTMLElement>("#menu");
    const theme = getThemePreference();
    menu.innerHTML = `
      ${canEdit ? `<button type="button" role="menuitem" data-action="preview">${icons.eye} Voir comme un invité</button>` : ""}
      ${opts.preview && storedKey ? `<button type="button" role="menuitem" data-action="edit">${icons.edit} Revenir à l'édition</button>` : ""}
      <button type="button" role="menuitem" data-action="theme">${icons.themeAuto} Thème : ${themeLabel(theme)}</button>
      <button type="button" role="menuitem" data-action="a11y">${icons.accessibility} Accessibilité</button>
      ${canOfferInstall() ? `<button type="button" role="menuitem" data-action="install">${icons.install} Installer l'app</button>` : ""}
    `;
  }

  function closeMenu(): void {
    $<HTMLElement>("#menu").hidden = true;
    $<HTMLElement>("#btn-menu").setAttribute("aria-expanded", "false");
  }

  function onDocumentClick(e: MouseEvent): void {
    if (!(e.target as HTMLElement).closest(".menu-wrap")) closeMenu();
  }

  $("#btn-menu").addEventListener("click", () => {
    const menu = $<HTMLElement>("#menu");
    if (!menu.hidden) return closeMenu();
    renderMenu();
    menu.hidden = false;
    $<HTMLElement>("#btn-menu").setAttribute("aria-expanded", "true");
  });
  $("#menu").addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action) return;
    closeMenu();
    if (action === "preview") navigate(`/l/${code}?lecture`);
    else if (action === "edit") navigate(`/l/${code}`);
    else if (action === "theme") cycleThemePreference();
    else if (action === "a11y") openAccessibilityModal();
    else if (action === "install") installApp();
  });
  document.addEventListener("click", onDocumentClick);

  $("#btn-back").addEventListener("click", () => navigate("/"));
  $("#btn-share").addEventListener("click", () => {
    if (state) openShareModal(code, state.name, canEdit ? editKey : null);
  });
  $("#btn-add").addEventListener("click", addItem);
  root.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#list-title")) startRename();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).id === "list-title") startRename();
  });

  function setupDnd(): void {
    disposeDnd?.();
    disposeDnd = null;
    if (!canEdit) return;
    disposeDnd = enableDragReorder(wishesEl, {
      containerSelector: ".wishes",
      itemSelector: ".wish",
      handleSelector: ".wish-handle",
      onDrop: () => {
        dragging = false;
        const orderedIds = Array.from(wishesEl.querySelectorAll<HTMLElement>(".wish")).map((el) => el.dataset.id!);
        if (state) {
          for (const item of state.items) item.order = orderedIds.indexOf(item.id);
        }
        conn.send({ type: "reorderItems", orderedIds });
        if (renderPending) {
          renderPending = false;
          renderItems();
        }
      },
    });
  }
  wishesEl.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".wish-handle")) dragging = true;
  });

  // ---------- Synchronisation ----------

  const unsubs = [
    conn.onState((next) => {
      state = next;
      notFound = false;
      cacheListState(next);
      touchRecentList(next.code, next.name);
      flushPendingUploads();
      render();
    }),
    conn.onWelcome((serverCanEdit) => {
      // Clé refusée par le serveur (liste recréée, clé erronée…) : on
      // repasse en lecture seule et on oublie la clé, inutile désormais.
      if (editKey && !serverCanEdit) {
        forgetEditKey(code);
        showToast("Ta clé d'édition n'est pas valide : liste ouverte en lecture seule.");
      }
      if (canEdit !== serverCanEdit) {
        canEdit = serverCanEdit;
        setupDnd();
        render();
      }
    }),
    conn.onPresence((count) => {
      presence = count;
      renderHeader();
    }),
    conn.onConnectionChange((isConnected) => {
      connected = isConnected;
      renderHeader();
    }),
    conn.onError((message) => showToast(message)),
  ];

  render();
  setupDnd();

  // Vérifie d'abord que la liste existe (une connexion WebSocket vers un
  // code inconnu échouerait en boucle) avant d'ouvrir la connexion.
  fetchListState(code)
    .then((initial) => {
      if (!initial) {
        notFound = true;
        state = null;
        render();
        return;
      }
      state = state ?? initial;
      render();
      conn.connect();
    })
    .catch(() => {
      loadError = state === null;
      render();
      // Hors ligne : on tente quand même la connexion (reconnexion auto).
      conn.connect();
    });

  return () => {
    for (const unsub of unsubs) unsub();
    conn.disconnect();
    disposeDnd?.();
    document.removeEventListener("click", onDocumentClick);
    if (undoTimer) clearTimeout(undoTimer);
    document.getElementById("toast")?.remove();
  };
}
