import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { promptInstall } from "../lib/install";

/** Lance l'installation : invite native du navigateur quand elle existe,
 * sinon (iPhone/iPad) une petite modale expliquant la marche à suivre. */
export function installApp(): void {
  void promptInstall(openIosInstructions);
}

function openIosInstructions(): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" tabindex="-1">
      <button type="button" class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2 id="install-title">Installer KesKeJeVoeux</h2>
      <ol class="install-steps">
        <li>Dans Safari, touche le bouton <strong>Partager</strong> <span class="install-inline-icon">${icons.shareIos}</span> en bas de l'écran.</li>
        <li>Choisis <strong>« Sur l'écran d'accueil »</strong> <span class="install-inline-icon">${icons.plusSquare}</span>.</li>
        <li>Touche <strong>Ajouter</strong> : l'app apparaît avec les autres.</li>
      </ol>
      <div class="modal-actions"><button type="button" class="btn primary" id="install-ok">J'ai compris</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
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
  overlay.querySelector("#install-ok")?.addEventListener("click", close);
}
