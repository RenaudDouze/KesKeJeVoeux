import { renderQrSvg } from "./qr";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { appPath } from "../lib/basePath";
import { editUrl, readUrl } from "../lib/editLink";

/** Modale de partage. Met en avant le lien de lecture seule (celui à
 * envoyer) ; le lien d'édition, lui, n'est proposé qu'à qui a déjà la clé,
 * replié et clairement signalé comme personnel. */
export function openShareModal(code: string, listName: string, editKey: string | null): void {
  const listPath = appPath(`/l/${code}`);
  const shareUrl = readUrl(location.origin, listPath);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" tabindex="-1">
      <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2 id="share-title">Partager « ${escapeHtml(listName)} »</h2>
      <p class="hint">Ce lien permet de <strong>voir</strong> la liste, pas de la modifier.</p>
      <div class="share-code" title="Code de la liste">${escapeHtml(code)}</div>
      <div class="qr-wrap" id="qr-wrap" aria-label="QR code du lien de lecture"></div>
      <p class="share-link" id="share-read-url">${escapeHtml(shareUrl)}</p>
      <div class="share-actions">
        <button class="btn" id="copy-link">Copier le lien</button>
        ${"share" in navigator ? '<button class="btn primary" id="native-share">Partager…</button>' : ""}
      </div>
      ${
        editKey
          ? `<details class="edit-link-box">
              <summary>${icons.lock} Lien d'édition (pour toi seul·e)</summary>
              <p class="hint">Ce lien donne le droit de <strong>modifier</strong> la liste. Ne l'envoie pas : garde-le pour ouvrir ta liste sur un autre appareil.</p>
              <p class="share-link" id="share-edit-url">${escapeHtml(editUrl(location.origin, listPath, editKey))}</p>
              <div class="share-actions"><button class="btn" id="copy-edit-link">Copier le lien d'édition</button></div>
            </details>`
          : ""
      }
    </div>
  `;
  document.body.appendChild(overlay);

  renderQrSvg(shareUrl).then((svg) => {
    const wrap = overlay.querySelector("#qr-wrap");
    if (wrap) wrap.innerHTML = svg;
  });

  const releaseFocusTrap = trapFocus(overlay.querySelector(".modal") as HTMLElement);

  function close(): void {
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
  overlay.querySelector(".modal-close")?.addEventListener("click", close);

  overlay.querySelector("#copy-link")?.addEventListener("click", async () => {
    await copyText(shareUrl);
    flash(overlay, "#copy-link", "Copié !");
  });
  overlay.querySelector("#copy-edit-link")?.addEventListener("click", async () => {
    if (!editKey) return;
    await copyText(editUrl(location.origin, listPath, editKey));
    flash(overlay, "#copy-edit-link", "Copié !");
  });
  overlay.querySelector("#native-share")?.addEventListener("click", async () => {
    try {
      await navigator.share({ title: listName, url: shareUrl });
    } catch {
      // partage annulé
    }
  });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // API presse-papiers indisponible (navigateur ancien / pas de https)
  }
}

function flash(root: HTMLElement, selector: string, text: string): void {
  const el = root.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const original = el.textContent;
  el.textContent = text;
  setTimeout(() => {
    el.textContent = original;
  }, 1200);
}
