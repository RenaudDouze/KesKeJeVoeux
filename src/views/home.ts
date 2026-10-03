import { createList, fetchListState } from "../lib/http";
import { forgetEditKey, forgetRecentList, getEditKey, getRecentLists, saveEditKey, touchRecentList, type RecentList } from "../lib/storage";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { cycleThemePreference, getThemePreference, themeLabel, type ThemePreference } from "../lib/theme";
import { openAccessibilityModal } from "../components/accessibilityModal";
import { wireConfirmClick } from "../lib/confirmClick";

const THEME_ICON: Record<ThemePreference, string> = { system: icons.themeAuto, light: icons.sun, dark: icons.moon };

export function mountHomeView(root: HTMLElement, navigate: (path: string) => void): () => void {
  render();

  function recentItemHtml(r: RecentList): string {
    const editable = getEditKey(r.code) !== null;
    return `
      <li class="recent-item">
        <button type="button" class="recent-open" data-code="${escapeHtml(r.code)}">
          <span class="recent-name">${escapeHtml(r.name)}</span>
          <span class="mode-tag ${editable ? "mode-tag-edit" : "mode-tag-read"}">${editable ? "Ma liste" : "Lecture"}</span>
        </button>
        <button type="button" class="icon-btn recent-forget" data-code="${escapeHtml(r.code)}" aria-label="Oublier cette liste" title="Oublier cette liste">${icons.close}</button>
      </li>`;
  }

  function render(): void {
    const recents = getRecentLists();
    const mine = recents.filter((r) => getEditKey(r.code) !== null);
    const others = recents.filter((r) => getEditKey(r.code) === null);
    const theme = getThemePreference();
    root.innerHTML = `
      <div class="home">
        <div class="home-toolbar">
          <button type="button" class="icon-btn" id="btn-accessibility" aria-label="Accessibilité" title="Accessibilité">${icons.accessibility}</button>
          <button type="button" class="icon-btn" id="theme-toggle" aria-label="Thème : ${themeLabel(theme)}" title="Thème : ${themeLabel(theme)}">${THEME_ICON[theme]}</button>
        </div>
        <header class="home-header">
          <div class="logo">${icons.gift}</div>
          <h1>KesKeJeVoeux</h1>
          <p class="tagline">Ma liste de souhaits, à partager en lecture seule.</p>
        </header>

        ${
          mine.length
            ? `<section class="card">
                <h2>Mes listes</h2>
                <ul class="recent-list">${mine.map(recentItemHtml).join("")}</ul>
              </section>`
            : ""
        }

        <section class="card">
          <h2>Nouvelle liste</h2>
          <form id="create-form" class="row">
            <input id="create-name" type="text" placeholder="Nom de la liste (optionnel)" maxlength="80" aria-label="Nom de la liste" />
            <button type="submit" class="btn primary">Créer</button>
          </form>
          <p class="hint">Tu seras seul·e à pouvoir la modifier. Tu pourras la partager avec un lien en lecture seule.</p>
        </section>

        ${
          others.length
            ? `<section class="card">
                <h2>Listes consultées</h2>
                <ul class="recent-list">${others.map(recentItemHtml).join("")}</ul>
              </section>`
            : ""
        }

        <section class="card">
          <h2>Consulter une liste</h2>
          <form id="join-form" class="row">
            <input id="join-code" type="text" placeholder="Code à 6 caractères" maxlength="10" autocapitalize="characters" aria-label="Code de la liste" />
            <button type="submit" class="btn">Ouvrir</button>
          </form>
          <p id="join-error" class="error" hidden></p>
        </section>
      </div>
    `;

    root.querySelector("#theme-toggle")?.addEventListener("click", () => {
      cycleThemePreference();
      render();
    });
    root.querySelector("#btn-accessibility")?.addEventListener("click", openAccessibilityModal);

    root.querySelector("#create-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = root.querySelector("#create-name") as HTMLInputElement;
      const btn = (e.target as HTMLFormElement).querySelector("button") as HTMLButtonElement;
      btn.disabled = true;
      try {
        const { state, editKey } = await createList(nameInput.value.trim());
        saveEditKey(state.code, editKey);
        touchRecentList(state.code, state.name);
        navigate(`/l/${state.code}`);
      } catch {
        alert("Impossible de créer la liste. Vérifie ta connexion internet.");
        btn.disabled = false;
      }
    });

    root.querySelector("#join-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = root.querySelector("#join-code") as HTMLInputElement;
      const errorEl = root.querySelector("#join-error") as HTMLElement;
      const btn = (e.target as HTMLFormElement).querySelector("button") as HTMLButtonElement;
      const code = input.value.trim().toUpperCase();
      errorEl.hidden = true;
      if (!code) return;
      btn.disabled = true;
      try {
        const state = await fetchListState(code);
        if (!state) {
          errorEl.textContent = "Aucune liste ne correspond à ce code.";
          errorEl.hidden = false;
        } else {
          touchRecentList(state.code, state.name);
          navigate(`/l/${state.code}`);
        }
      } catch {
        errorEl.textContent = "Erreur réseau, réessaie.";
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelectorAll<HTMLButtonElement>(".recent-open").forEach((btn) => {
      btn.addEventListener("click", () => navigate(`/l/${btn.dataset.code}`));
    });
    root.querySelectorAll<HTMLButtonElement>(".recent-forget").forEach((btn) => {
      const code = btn.dataset.code!;
      // Oublier une liste dont on a la clé fait perdre le droit de la
      // modifier depuis cet appareil : confirmation en deux clics.
      wireConfirmClick(btn, {
        armedLabel: getEditKey(code) ? "Confirmer : oublier la liste et sa clé d'édition" : "Confirmer : oublier la liste",
        onConfirm: () => {
          forgetRecentList(code);
          forgetEditKey(code);
          render();
        },
      });
    });
  }

  return () => {};
}
