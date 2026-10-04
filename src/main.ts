import "./style.css";
import { mountHomeView } from "./views/home";
import { mountListView } from "./views/list";
import { applyTheme, getThemePreference } from "./lib/theme";
import { applyAccessibilityPreference, getAccessibilityPreference } from "./lib/accessibilityPreference";
import { appPath, routePath } from "./lib/basePath";
import { editKeyFromHash } from "./lib/editLink";
import { saveEditKey } from "./lib/storage";
import { initInstallPrompt } from "./lib/install";

// Appliqué avant le premier rendu pour éviter un flash du mauvais thème.
applyTheme(getThemePreference());
applyAccessibilityPreference(getAccessibilityPreference());
initInstallPrompt();

const app = document.getElementById("app")!;
let cleanup: (() => void) | null = null;

const LIST_ROUTE = /^\/l\/([A-Za-z0-9]+)\/?$/;

function navigate(path: string, replace = false): void {
  const target = appPath(path);
  if (location.pathname + location.search !== target) {
    if (replace) history.replaceState({}, "", target);
    else history.pushState({}, "", target);
  }
  render();
}

/** Un lien d'édition (#cle=..., voir src/lib/editLink.ts) : la clé est
 * mémorisée sur cet appareil puis aussitôt retirée de la barre d'adresse,
 * pour qu'un copier-coller de l'URL ne partage que la lecture. */
function consumeEditKeyFromUrl(code: string): void {
  const key = editKeyFromHash(location.hash);
  if (!location.hash) return;
  if (key) saveEditKey(code, key);
  history.replaceState({}, "", location.pathname + location.search);
}

function render(): void {
  cleanup?.();
  cleanup = null;

  const match = routePath().match(LIST_ROUTE);
  if (match) {
    const code = match[1].toUpperCase();
    consumeEditKeyFromUrl(code);
    // ?lecture : aperçu de ce que voient les invités, même avec la clé.
    const preview = new URLSearchParams(location.search).has("lecture");
    cleanup = mountListView(app, code, { preview }, navigate);
  } else {
    cleanup = mountHomeView(app, navigate);
  }
}

window.addEventListener("popstate", render);
render();
