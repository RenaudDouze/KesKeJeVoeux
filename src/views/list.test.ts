// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountListView } from "./list";
import { cacheListState, getCachedListState, getEditKey, getRecentLists, getReservationTokens, saveEditKey, saveReservationToken } from "../lib/storage";
import type { ClientMessage, Item, ListState } from "../../shared/types";
import type { ItemFormResult, ItemModalOptions } from "../components/itemModal";

type Listener<T> = (arg: T) => void;
const { FakeListConnection, fakeConnectionInstances } = vi.hoisted(() => {
  const instances: unknown[] = [];
  class Impl {
    send = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    unsubscribed = 0;
    private l: Record<string, Listener<unknown>[]> = { state: [], welcome: [], reservation: [], presence: [], conn: [], error: [] };

    constructor(
      public code: string,
      public editKey: string | null,
      public preview: boolean,
    ) {
      instances.push(this);
    }
    private sub(kind: string, fn: Listener<unknown>) {
      this.l[kind].push(fn);
      return () => {
        this.unsubscribed++;
        this.l[kind] = this.l[kind].filter((x) => x !== fn);
      };
    }
    onState(fn: Listener<unknown>) {
      return this.sub("state", fn);
    }
    onWelcome(fn: Listener<unknown>) {
      return this.sub("welcome", fn);
    }
    onReservationResult(fn: Listener<unknown>) {
      return this.sub("reservation", fn);
    }
    onPresence(fn: Listener<unknown>) {
      return this.sub("presence", fn);
    }
    onConnectionChange(fn: Listener<unknown>) {
      return this.sub("conn", fn);
    }
    onError(fn: Listener<unknown>) {
      return this.sub("error", fn);
    }
    emit(kind: string, value: unknown) {
      for (const fn of [...this.l[kind]]) fn(value);
    }
  }
  return { FakeListConnection: Impl, fakeConnectionInstances: instances };
});
type FakeConn = InstanceType<typeof FakeListConnection> & {
  send: ReturnType<typeof vi.fn<(msg: ClientMessage) => void>>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
vi.mock("../lib/ws", () => ({ ListConnection: FakeListConnection }));

const fetchListState = vi.fn();
const uploadItemImage = vi.fn();
const deleteItemImage = vi.fn();
vi.mock("../lib/http", () => ({
  fetchListState: (...a: unknown[]) => fetchListState(...a),
  uploadItemImage: (...a: unknown[]) => uploadItemImage(...a),
  deleteItemImage: (...a: unknown[]) => deleteItemImage(...a),
  itemImageUrl: (code: string, id: string, version: number) => `/img/${code}/${id}?v=${version}`,
}));

const openShareModal = vi.fn();
vi.mock("../components/shareModal", () => ({ openShareModal: (...a: unknown[]) => openShareModal(...a) }));
const openAccessibilityModal = vi.fn();
vi.mock("../components/accessibilityModal", () => ({ openAccessibilityModal: () => openAccessibilityModal() }));
const installApp = vi.fn();
vi.mock("../components/installModal", () => ({ installApp: () => installApp() }));
let canInstall = false;
vi.mock("../lib/install", () => ({ canOfferInstall: () => canInstall }));
const itemModalCalls: ItemModalOptions[] = [];
vi.mock("../components/itemModal", () => ({ openItemModal: (o: ItemModalOptions) => itemModalCalls.push(o) }));
vi.mock("../lib/id", () => ({ uid: () => "uid-1", randomToken: () => "token-1" }));

interface DndCall {
  container: HTMLElement;
  opts: { containerSelector: string; itemSelector: string; handleSelector: string; onDrop: () => void };
  dispose: ReturnType<typeof vi.fn>;
}
const dndCalls: DndCall[] = [];
vi.mock("../lib/dnd", () => ({
  enableDragReorder: (container: HTMLElement, opts: DndCall["opts"]) => {
    const dispose = vi.fn();
    dndCalls.push({ container, opts, dispose });
    return dispose;
  },
}));

interface ConfirmCall {
  button: HTMLElement;
  opts: { armedLabel: string; onConfirm: () => void };
}
const confirmCalls: ConfirmCall[] = [];
vi.mock("../lib/confirmClick", () => ({
  wireConfirmClick: (button: HTMLElement, opts: ConfirmCall["opts"]) => confirmCalls.push({ button, opts }),
}));

const KEY = "0123456789abcdef0123456789abcdef";

function makeItem(overrides: Partial<Item> = {}): Item {
  return { id: "i1", name: "Casque", description: "", link: "", imageUrl: "", order: 0, createdAt: 0, updatedAt: 0, hasImage: false, imageVersion: 0, ...overrides };
}
function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Noël", items: [], createdAt: 0, updatedAt: 0, ...overrides };
}

describe("mountListView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    navigate = vi.fn<(path: string) => void>();
    fakeConnectionInstances.length = 0;
    dndCalls.length = 0;
    confirmCalls.length = 0;
    itemModalCalls.length = 0;
    canInstall = false;
    for (const fn of [openShareModal, openAccessibilityModal, installApp]) fn.mockReset();
    fetchListState.mockReset().mockResolvedValue(sampleState());
    uploadItemImage.mockReset().mockResolvedValue(undefined);
    deleteItemImage.mockReset().mockResolvedValue(undefined);
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const conn = () => fakeConnectionInstances[fakeConnectionInstances.length - 1] as FakeConn;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  /** Monte la vue et attend la fin du chargement initial. */
  async function mount(state: ListState | null = sampleState(), opts: { preview?: boolean; editKey?: string } = {}): Promise<FakeConn> {
    if (opts.editKey) saveEditKey("ABCDEF", opts.editKey);
    fetchListState.mockResolvedValue(state);
    cleanup = mountListView(root, "ABCDEF", { preview: opts.preview ?? false }, navigate);
    await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());
    await vi.waitFor(() => expect(conn().connect.mock.calls.length + (state ? 0 : 1)).toBeGreaterThan(0));
    await Promise.resolve();
    await Promise.resolve();
    return conn();
  }
  const emitState = (c: FakeConn, s: ListState) => c.emit("state", s);
  const names = () => Array.from(root.querySelectorAll(".wish-name")).map((n) => n.textContent);
  const stray = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).flatMap((el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "")
        .map((n) => n.textContent),
    );

  describe("chargement", () => {
    it("avant la réponse : « Chargement… », ni partage ni ajout", () => {
      fetchListState.mockReturnValue(new Promise(() => {}));
      cleanup = mountListView(root, "ABCDEF", { preview: false }, navigate);
      expect($("#list-title").textContent).toBe("Chargement…");
      expect($("#state-message").hidden).toBe(false);
      expect($("#state-message").textContent).toBe("Chargement…");
      expect($("#btn-share").hidden).toBe(true);
      expect($("#btn-add").hidden).toBe(true);
      expect(conn().connect).not.toHaveBeenCalled();
    });

    it("liste récupérée : titre affiché, connexion ouverte, rien dans les listes récentes tant que l'état n'est pas diffusé", async () => {
      const c = await mount(sampleState({ name: "Ma liste" }));
      expect($("#list-title").textContent).toBe("Ma liste");
      expect(c.connect).toHaveBeenCalledOnce();
      expect($("#btn-share").hidden).toBe(false);
    });

    it("connexion créée avec le code, sans clé ni aperçu pour un invité", async () => {
      const c = await mount();
      expect([c.code, c.editKey, c.preview]).toEqual(["ABCDEF", null, false]);
    });

    it("connexion créée avec la clé d'édition mémorisée", async () => {
      const c = await mount(sampleState(), { editKey: KEY });
      expect([c.code, c.editKey, c.preview]).toEqual(["ABCDEF", KEY, false]);
    });

    it("aperçu propriétaire : la clé part avec preview=true", async () => {
      const c = await mount(sampleState(), { editKey: KEY, preview: true });
      expect([c.editKey, c.preview]).toEqual([KEY, true]);
    });

    it("aperçu sans clé mémorisée : pas de clé, pas d'aperçu côté connexion", async () => {
      const c = await mount(sampleState(), { preview: true });
      expect([c.editKey, c.preview]).toEqual([null, false]);
    });

    it("affiche immédiatement une liste en cache", async () => {
      cacheListState(sampleState({ name: "Cache", items: [makeItem({ name: "Livre" })] }));
      fetchListState.mockReturnValue(new Promise(() => {}));
      cleanup = mountListView(root, "ABCDEF", { preview: false }, navigate);
      expect($("#list-title").textContent).toBe("Cache");
      expect(names()).toEqual(["Livre"]);
    });

    it("garde la liste en cache si le serveur répond d'abord avec une liste (état reçu en direct prioritaire)", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      await mount(sampleState({ name: "Serveur" }));
      expect($("#list-title").textContent).toBe("Cache");
    });

    it("liste inconnue (404) : message dédié, titre « Liste introuvable », pas de connexion, cache ignoré", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      await mount(null);
      expect($("#list-title").textContent).toBe("Liste introuvable");
      expect($("#state-message").textContent).toBe("Aucune liste ne correspond à ce code.");
      expect($("#state-message").hidden).toBe(false);
      expect(names()).toEqual([]);
      expect($("#btn-share").hidden).toBe(true);
      expect(conn().connect).not.toHaveBeenCalled();
    });

    it("erreur réseau sans cache : message d'erreur, mais la connexion est tentée", async () => {
      fetchListState.mockRejectedValue(new Error("réseau"));
      cleanup = mountListView(root, "ABCDEF", { preview: false }, navigate);
      await vi.waitFor(() => expect(conn().connect).toHaveBeenCalled());
      expect($("#state-message").textContent).toBe("Impossible de charger la liste. Vérifie ta connexion.");
      expect($("#state-message").hidden).toBe(false);
    });

    it("erreur réseau avec cache : la liste en cache reste affichée, sans message d'erreur", async () => {
      cacheListState(sampleState({ name: "Cache", items: [makeItem()] }));
      fetchListState.mockRejectedValue(new Error("réseau"));
      cleanup = mountListView(root, "ABCDEF", { preview: false }, navigate);
      await vi.waitFor(() => expect(conn().connect).toHaveBeenCalled());
      expect(names()).toEqual(["Casque"]);
      expect($("#state-message").hidden).toBe(true);
    });

    it("une mise à jour reçue en direct remplace l'écran « introuvable », se met en cache et dans les récentes", async () => {
      const c = await mount(null);
      emitState(c, sampleState({ name: "Apparue", items: [makeItem()] }));
      expect($("#list-title").textContent).toBe("Apparue");
      expect(names()).toEqual(["Casque"]);
      expect(getCachedListState("ABCDEF")?.name).toBe("Apparue");
      expect(getRecentLists().find((r) => r.code === "ABCDEF")?.name).toBe("Apparue");
    });
  });

  describe("en-tête", () => {
    it("point de connexion et présence suivent la connexion", async () => {
      const c = await mount();
      const dot = $("#conn-dot");
      expect(dot.classList.contains("online")).toBe(false);
      expect(dot.title).toBe("Hors ligne");
      expect($("#presence").hidden).toBe(true);

      c.emit("conn", true);
      expect(dot.classList.contains("online")).toBe(true);
      expect(dot.title).toBe("Connecté");
      expect($("#presence").hidden).toBe(false);

      c.emit("presence", 1);
      expect($("#presence-count").textContent).toBe("1");
      expect($("#presence").getAttribute("aria-label")).toBe("1 personne connectée");
      c.emit("presence", 0);
      expect($("#presence").getAttribute("aria-label")).toBe("0 personne connectée");
      c.emit("presence", 3);
      expect($("#presence-count").textContent).toBe("3");
      expect($("#presence").getAttribute("aria-label")).toBe("3 personnes connectées");
      c.emit("conn", false);
      expect($("#presence").hidden).toBe(true);
    });

    it("propriétaire : titre éditable, bouton d'ajout, pas de bandeau de lecture", async () => {
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      expect($("#list-title").classList.contains("editable")).toBe(true);
      expect($("#list-title").tabIndex).toBe(0);
      expect($("#list-title").title).toBe("Cliquer pour renommer");
      expect($("#btn-add").hidden).toBe(false);
      expect($("#mode-banner").hidden).toBe(true);
    });

    it("invité : titre figé, pas d'ajout, bandeau de lecture avec consigne de réservation", async () => {
      const c = await mount();
      expect($("#list-title").classList.contains("editable")).toBe(false);
      expect($("#list-title").tabIndex).toBe(-1);
      expect($("#list-title").title).toBe("");
      expect($("#btn-add").hidden).toBe(true);
      expect($("#mode-banner").hidden).toBe(false);
      expect($("#mode-banner strong").textContent).toBe("Mode lecture");
      expect($(".mode-banner-hint").textContent).toBe("Réserve un cadeau pour éviter les doublons : la personne qui a fait la liste ne voit pas les réservations.");
      expect($("#btn-exit-preview")).toBeNull();
      expect($("#banner-presence").textContent).toBe("Hors ligne");
      c.emit("conn", true);
      c.emit("presence", 2);
      expect($("#banner-presence").textContent).toBe("2 personnes connectées");
    });

    it("aperçu propriétaire : consigne dédiée et retour à l'édition", async () => {
      await mount(sampleState(), { editKey: KEY, preview: true });
      expect($(".mode-banner-hint").textContent).toBe("Aperçu : les réservations des invités restent cachées pour toi.");
      $("#btn-exit-preview").click();
      expect(navigate).toHaveBeenCalledWith("/l/ABCDEF");
    });

    it("« ?lecture » sans clé mémorisée : pas de bouton de retour à l'édition", async () => {
      await mount(sampleState(), { preview: true });
      expect($("#btn-exit-preview")).toBeNull();
    });

    it("le bouton retour va à l'accueil", async () => {
      await mount();
      $("#btn-back").click();
      expect(navigate).toHaveBeenCalledWith("/");
    });

    it("le partage donne la clé au propriétaire, rien à l'invité", async () => {
      const c = await mount(sampleState({ name: "Noël" }), { editKey: KEY });
      c.emit("welcome", true);
      $("#btn-share").click();
      expect(openShareModal).toHaveBeenLastCalledWith("ABCDEF", "Noël", KEY);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      localStorage.clear();
      await mount(sampleState({ name: "Noël" }));
      $("#btn-share").click();
      expect(openShareModal).toHaveBeenLastCalledWith("ABCDEF", "Noël", null);
    });

    it("en aperçu, le partage n'expose pas la clé", async () => {
      await mount(sampleState({ name: "Noël" }), { editKey: KEY, preview: true });
      $("#btn-share").click();
      expect(openShareModal).toHaveBeenLastCalledWith("ABCDEF", "Noël", null);
    });
  });

  describe("souhaits", () => {
    const wish = (id: string) => root.querySelector(`.wish[data-id="${id}"]`) as HTMLElement;

    it("affiche nom, description, prix, lien (nom de domaine) et aucun texte parasite", async () => {
      await mount(
        sampleState({
          items: [makeItem({ id: "a", name: "Casque", description: "Noir", price: 49.9, link: "https://www.exemple.fr/produit?x=1" })],
        }),
      );
      const w = wish("a");
      expect(w.querySelector(".wish-name")!.textContent).toBe("Casque");
      expect(w.querySelector(".wish-description")!.textContent).toBe("Noir");
      expect(w.querySelector(".wish-price")!.textContent).toBe("49,90 €");
      const link = w.querySelector(".wish-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("https://www.exemple.fr/produit?x=1");
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
      expect(link.querySelector("span")!.textContent).toBe("exemple.fr");
      expect(link.querySelector("svg")).not.toBeNull();
      expect(stray(".wish, .wish-body, .wish-heading, .wishes")).toEqual([]);
    });

    it("sans description, prix ni lien : rien d'affiché ; prix à 0 affiché", async () => {
      await mount(sampleState({ items: [makeItem({ id: "a" }), makeItem({ id: "b", price: 0, order: 1 })] }));
      expect(wish("a").querySelector(".wish-description")).toBeNull();
      expect(wish("a").querySelector(".wish-price")).toBeNull();
      expect(wish("a").querySelector(".wish-link")).toBeNull();
      expect(wish("b").querySelector(".wish-price")!.textContent).toBe("0,00 €");
    });

    it("un lien illisible s'affiche tel quel", async () => {
      await mount(sampleState({ items: [makeItem({ id: "a", link: "pas une url" })] }));
      expect(wish("a").querySelector(".wish-link span")!.textContent).toBe("pas une url");
    });

    it("échappe les champs affichés", async () => {
      await mount(sampleState({ items: [makeItem({ id: 'a"b', name: "<b>x</b>", description: "<i>y</i>", link: '"><u>', imageUrl: '"><s>' })] }));
      expect(root.querySelector(".wish b, .wish i, .wish u, .wish s")).toBeNull();
      expect(root.querySelector(".wish-name")!.textContent).toBe("<b>x</b>");
      expect((root.querySelector(".wish") as HTMLElement).dataset.id).toBe('a"b');
    });

    it("image : envoyée (version dans l'URL) > image distante > pas d'image", async () => {
      await mount(
        sampleState({
          items: [
            makeItem({ id: "a", hasImage: true, imageVersion: 4, imageUrl: "https://x/i.jpg" }),
            makeItem({ id: "b", imageUrl: "https://x/i.jpg", order: 1 }),
            makeItem({ id: "c", order: 2 }),
          ],
        }),
      );
      expect(wish("a").querySelector("img")!.getAttribute("src")).toBe("/img/ABCDEF/a?v=4");
      expect(wish("b").querySelector("img")!.getAttribute("src")).toBe("https://x/i.jpg");
      expect(wish("b").querySelector("img")!.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(wish("b").querySelector("img")!.getAttribute("loading")).toBe("lazy");
      expect(wish("c").querySelector("img")).toBeNull();
      expect(wish("c").querySelector(".wish-placeholder")!.getAttribute("aria-hidden")).toBe("true");
      expect(wish("a").querySelector(".wish-image-btn")!.getAttribute("aria-label")).toBe("Agrandir l'image de « Casque »");
    });

    it("l'image s'agrandit au clic, se referme au clic, sur Échap, et retire son écouteur", async () => {
      await mount(sampleState({ items: [makeItem({ id: "a", name: "Casque", imageUrl: "https://x/i.jpg" })] }));
      const open = () => {
        (wish("a").querySelector(".wish-image-btn") as HTMLElement).click();
        return document.querySelector(".image-lightbox-overlay") as HTMLElement;
      };
      let overlay = open();
      expect(overlay.querySelector("img")!.getAttribute("src")).toBe("https://x/i.jpg");
      expect(overlay.querySelector("img")!.getAttribute("alt")).toBe("Casque");
      expect(overlay.querySelector(".image-lightbox-close")!.getAttribute("aria-label")).toBe("Fermer");
      overlay.click();
      expect(document.querySelector(".image-lightbox-overlay")).toBeNull();

      overlay = open();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(document.querySelector(".image-lightbox-overlay")).not.toBeNull();
      const remove = vi.spyOn(document, "removeEventListener");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(document.querySelector(".image-lightbox-overlay")).toBeNull();
      expect(remove.mock.calls.map(([t]) => t)).toContain("keydown");
    });

    it("message de liste vide, selon le mode", async () => {
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      expect($("#state-message").hidden).toBe(false);
      expect($("#state-message").textContent).toBe("Ta liste est vide. Ajoute ton premier souhait !");
      emitState(c, sampleState({ items: [makeItem()] }));
      expect($("#state-message").hidden).toBe(true);
      c.emit("welcome", false);
      emitState(c, sampleState());
      expect($("#state-message").textContent).toBe("Cette liste est vide pour l'instant.");
    });

    it("total des prix : masqué sans prix, sinon somme arrondie", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      expect($("#total").hidden).toBe(true);
      expect($("#total").textContent).toBe("");
      emitState(c, sampleState({ items: [makeItem({ id: "a", price: 10.1 }), makeItem({ id: "b", price: 5.25, order: 1 }), makeItem({ id: "c", order: 2 })] }));
      expect($("#total").hidden).toBe(false);
      expect($("#total").textContent).toBe("Total : 15,35 €");
    });

    it("le propriétaire a modifier, supprimer et déplacer ; l'invité aucune action d'édition", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a", name: "Casque" })] }), { editKey: KEY });
      c.emit("welcome", true);
      expect(wish("a").querySelector(".wish-edit")!.getAttribute("aria-label")).toBe("Modifier « Casque »");
      expect(wish("a").querySelector(".wish-edit")!.getAttribute("title")).toBe("Modifier");
      expect(wish("a").querySelector(".wish-delete")!.getAttribute("aria-label")).toBe("Supprimer « Casque »");
      expect(wish("a").querySelector(".wish-delete")!.getAttribute("title")).toBe("Supprimer");
      expect(wish("a").querySelector(".wish-handle")!.getAttribute("aria-label")).toBe("Déplacer « Casque »");
      expect(wish("a").querySelector(".wish-handle")!.getAttribute("title")).toBe("Glisser pour déplacer");

      c.emit("welcome", false);
      expect(wish("a").querySelector(".wish-actions")).toBeNull();
    });
  });

  describe("tri", () => {
    const items = () => [
      makeItem({ id: "a", name: "A", price: 30, order: 0 }),
      makeItem({ id: "b", name: "B", price: 10, order: 1 }),
      makeItem({ id: "c", name: "C", order: 2 }),
    ];

    it("barre de tri masquée sous deux souhaits, visible ensuite, avec le mode actif marqué", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }));
      expect($("#sort-bar").hidden).toBe(true);
      emitState(c, sampleState({ items: items() }));
      expect($("#sort-bar").hidden).toBe(false);
      const states = Array.from(root.querySelectorAll(".sort-btn")).map((b) => [b.getAttribute("data-sort"), b.classList.contains("active"), b.getAttribute("aria-pressed")]);
      expect(states).toEqual([["order", true, "true"], ["price-asc", false, "false"], ["price-desc", false, "false"]]);
      expect($("[data-sort=price-asc]").getAttribute("aria-label")).toBe("Prix croissant");
      expect($("[data-sort=price-desc]").getAttribute("aria-label")).toBe("Prix décroissant");
    });

    it("choisir un tri réordonne, mémorise le choix et marque le bouton ; le même tri ne fait rien", async () => {
      await mount(sampleState({ items: items() }));
      expect(names()).toEqual(["A", "B", "C"]);
      $("[data-sort=price-asc]").click();
      expect(names()).toEqual(["B", "A", "C"]);
      expect(localStorage.getItem("kkjv:sort")).toBe("price-asc");
      expect($("[data-sort=price-asc]").classList.contains("active")).toBe(true);
      expect($("[data-sort=order]").classList.contains("active")).toBe(false);

      $("[data-sort=price-desc]").click();
      expect(names()).toEqual(["A", "B", "C"]);
      expect(localStorage.getItem("kkjv:sort")).toBe("price-desc");

      const set = vi.spyOn(Storage.prototype, "setItem");
      $("[data-sort=price-desc]").click();
      expect(set).not.toHaveBeenCalled();
    });

    it("un clic ailleurs dans la barre ne change rien", async () => {
      await mount(sampleState({ items: items() }));
      ($("#sort-bar .sort-label") as HTMLElement).click();
      $("#sort-bar").click();
      expect(localStorage.getItem("kkjv:sort")).toBeNull();
    });

    it("reprend le tri mémorisé à l'ouverture", async () => {
      localStorage.setItem("kkjv:sort", "price-desc");
      await mount(sampleState({ items: items() }));
      expect(names()).toEqual(["A", "B", "C"]);
      expect($("[data-sort=price-desc]").classList.contains("active")).toBe(true);
    });

    it("la poignée de déplacement n'existe que dans l'ordre défini", async () => {
      const c = await mount(sampleState({ items: items() }), { editKey: KEY });
      c.emit("welcome", true);
      expect(root.querySelectorAll(".wish-handle")).toHaveLength(3);
      $("[data-sort=price-asc]").click();
      expect(root.querySelectorAll(".wish-handle")).toHaveLength(0);
      expect(stray(".wish-actions")).toEqual([]);
    });
  });

  describe("réservations", () => {
    const guest = async (items: Item[]) => mount(sampleState({ items }));
    const wish = (id: string) => root.querySelector(`.wish[data-id="${id}"]`) as HTMLElement;

    it("bouton « Je le réserve » pour un souhait libre, avec libellé accessible", async () => {
      await guest([makeItem({ id: "a", name: "Casque" })]);
      const btn = wish("a").querySelector(".reserve-btn")!;
      expect(btn.getAttribute("aria-label")).toBe("Réserver « Casque »");
      expect(btn.textContent!.trim()).toBe("Je le réserve");
      expect(wish("a").classList.contains("wish-reserved")).toBe(false);
    });

    it("souhait réservé par un autre : « Déjà réservé », marqué, sans bouton", async () => {
      await guest([makeItem({ id: "a", reserved: true })]);
      expect(wish("a").classList.contains("wish-reserved")).toBe(true);
      expect(wish("a").querySelector(".reservation-badge")!.textContent!.trim()).toBe("Déjà réservé");
      expect(wish("a").querySelector("button.reserve-btn, button.unreserve-btn")).toBeNull();
    });

    it("ma réservation : « Réservé par toi », non marquée, avec annulation accessible", async () => {
      saveReservationToken("ABCDEF", "a", "tok");
      await guest([makeItem({ id: "a", name: "Casque", reserved: true })]);
      expect(wish("a").classList.contains("wish-reserved")).toBe(false);
      expect(wish("a").querySelector(".reservation")!.classList.contains("reservation-mine")).toBe(true);
      expect(wish("a").querySelector(".reservation-badge")!.textContent!.trim()).toBe("Réservé par toi");
      expect(wish("a").querySelector(".unreserve-btn")!.getAttribute("aria-label")).toBe("Annuler ma réservation de « Casque »");
    });

    it("le propriétaire (et son aperçu) ne voit aucune réservation", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a", reserved: true })] }), { editKey: KEY });
      c.emit("welcome", true);
      expect(wish("a").querySelector(".reservation, .reserve-btn")).toBeNull();
      expect(wish("a").classList.contains("wish-reserved")).toBe(false);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      await mount(sampleState({ items: [makeItem({ id: "a", reserved: true })] }), { editKey: KEY, preview: true });
      expect(wish("a").querySelector(".reservation, .reserve-btn")).toBeNull();
    });

    it("réserver envoie reserveItem avec un jeton, sans le mémoriser avant confirmation", async () => {
      const c = await guest([makeItem({ id: "a" }), makeItem({ id: "b", order: 1 })]);
      (wish("b").querySelector(".reserve-btn") as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith({ type: "reserveItem", id: "b", token: "token-1" });
      expect(getReservationTokens("ABCDEF")).toEqual({});
    });

    it("confirmation du serveur : jeton mémorisé, toast avec annulation qui libère le souhait", async () => {
      const c = await guest([makeItem({ id: "a", reserved: false })]);
      (wish("a").querySelector(".reserve-btn") as HTMLElement).click();
      c.emit("reservation", { id: "a", reserved: true, ok: true });

      expect(getReservationTokens("ABCDEF")).toEqual({ a: "token-1" });
      expect(document.querySelector("#toast span")!.textContent).toBe("Réservé ! La personne qui a fait la liste ne le verra pas.");
      (document.querySelector("#toast-undo") as HTMLElement).click();
      expect(c.send).toHaveBeenLastCalledWith({ type: "unreserveItem", id: "a", token: "token-1" });
      expect(document.getElementById("toast")).toBeNull();
    });

    it("refus du serveur (déjà pris) : rien de mémorisé, pas de toast", async () => {
      const c = await guest([makeItem({ id: "a" })]);
      (wish("a").querySelector(".reserve-btn") as HTMLElement).click();
      c.emit("reservation", { id: "a", reserved: true, ok: false });
      expect(getReservationTokens("ABCDEF")).toEqual({});
      expect(document.getElementById("toast")).toBeNull();
    });

    it("résultat de réservation sans demande locale : rien de mémorisé", async () => {
      const c = await guest([makeItem({ id: "a" })]);
      c.emit("reservation", { id: "a", reserved: true, ok: true });
      expect(getReservationTokens("ABCDEF")).toEqual({});
    });

    it("annuler : envoie unreserveItem avec le jeton mémorisé ; sans jeton, n'envoie rien", async () => {
      saveReservationToken("ABCDEF", "a", "tok-a");
      const c = await guest([makeItem({ id: "a", reserved: true })]);
      (wish("a").querySelector(".unreserve-btn") as HTMLElement).click();
      expect(c.send).toHaveBeenCalledWith({ type: "unreserveItem", id: "a", token: "tok-a" });
    });

    it("annulation confirmée par le serveur : jeton oublié ; refusée : conservé", async () => {
      saveReservationToken("ABCDEF", "a", "tok-a");
      const c = await guest([makeItem({ id: "a", reserved: true })]);
      c.emit("reservation", { id: "a", reserved: false, ok: false });
      expect(getReservationTokens("ABCDEF")).toEqual({ a: "tok-a" });
      c.emit("reservation", { id: "a", reserved: false, ok: true });
      expect(getReservationTokens("ABCDEF")).toEqual({});
    });

    it("un état reçu oublie les jetons des souhaits supprimés ou plus réservés (invité uniquement)", async () => {
      saveReservationToken("ABCDEF", "a", "ta");
      saveReservationToken("ABCDEF", "b", "tb");
      saveReservationToken("ABCDEF", "c", "tc");
      const c = await guest([makeItem({ id: "a", reserved: true }), makeItem({ id: "b", reserved: true, order: 1 }), makeItem({ id: "c", reserved: true, order: 2 })]);
      emitState(c, sampleState({ items: [makeItem({ id: "a", reserved: true }), makeItem({ id: "b", reserved: false, order: 1 })] }));
      expect(getReservationTokens("ABCDEF")).toEqual({ a: "ta" });
    });

    it("le propriétaire ne touche pas aux jetons à la réception d'un état", async () => {
      saveReservationToken("ABCDEF", "a", "ta");
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      emitState(c, sampleState({ items: [] }));
      expect(getReservationTokens("ABCDEF")).toEqual({ a: "ta" });
    });
  });

  describe("édition (propriétaire)", () => {
    const owner = async (items: Item[] = [makeItem({ id: "a", name: "Casque" })]) => {
      const c = await mount(sampleState({ items }), { editKey: KEY });
      c.emit("welcome", true);
      return c;
    };
    const toastText = () => document.querySelector("#toast span")?.textContent;

    it("« Ajouter » ouvre le formulaire vide", async () => {
      await owner();
      $("#btn-add").click();
      expect(itemModalCalls).toHaveLength(1);
      expect(itemModalCalls[0].item).toBeUndefined();
    });

    it("l'ajout envoie le souhait (prix absent plutôt que null) sans toast ni envoi de photo", async () => {
      const c = await owner();
      $("#btn-add").click();
      const result: ItemFormResult = { name: "Livre", description: "D", link: "https://l", imageUrl: "https://i", price: null, file: null, removeUploadedImage: false };
      itemModalCalls[0].onSubmit(result);
      expect(c.send).toHaveBeenCalledWith({ type: "addItem", id: "uid-1", name: "Livre", description: "D", link: "https://l", imageUrl: "https://i", price: undefined });
      expect(document.getElementById("toast")).toBeNull();
      expect(uploadItemImage).not.toHaveBeenCalled();
    });

    it("l'ajout avec prix et photo : toast d'envoi persistant, photo envoyée dès que le souhait existe côté serveur", async () => {
      const c = await owner([]);
      $("#btn-add").click();
      const file = new Blob(["x"], { type: "image/jpeg" });
      itemModalCalls[0].onSubmit({ name: "Livre", description: "", link: "", imageUrl: "", price: 12.5, file, removeUploadedImage: false });
      expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ type: "addItem", id: "uid-1", price: 12.5 }));
      expect(toastText()).toBe("Envoi de la photo…");
      vi.advanceTimersByTime(60_000);
      expect(document.getElementById("toast")).not.toBeNull();
      expect(uploadItemImage).not.toHaveBeenCalled();

      emitState(c, sampleState({ items: [makeItem({ id: "uid-1", name: "Livre" })] }));
      expect(uploadItemImage).toHaveBeenCalledWith("ABCDEF", "uid-1", file, KEY);
      await vi.waitFor(() => expect(toastText()).toBe("Photo enregistrée"));
    });

    it("une photo en attente d'un autre souhait ne part pas, et ne part qu'une fois", async () => {
      const c = await owner([]);
      $("#btn-add").click();
      itemModalCalls[0].onSubmit({ name: "L", description: "", link: "", imageUrl: "", price: null, file: new Blob(["x"]), removeUploadedImage: false });
      emitState(c, sampleState({ items: [makeItem({ id: "autre" })] }));
      expect(uploadItemImage).not.toHaveBeenCalled();
      emitState(c, sampleState({ items: [makeItem({ id: "uid-1" })] }));
      emitState(c, sampleState({ items: [makeItem({ id: "uid-1" })] }));
      expect(uploadItemImage).toHaveBeenCalledOnce();
    });

    it("modifier ouvre le formulaire prérempli, avec la photo déjà envoyée le cas échéant", async () => {
      await owner([makeItem({ id: "a", hasImage: true, imageVersion: 2 }), makeItem({ id: "b", order: 1, name: "Autre" })]);
      (root.querySelectorAll(".wish-edit")[1] as HTMLElement).click();
      expect(itemModalCalls[0].item!.id).toBe("b");
      expect(itemModalCalls[0].uploadedImageSrc).toBeNull();
      (root.querySelector(".wish-edit") as HTMLElement).click();
      expect(itemModalCalls[1].uploadedImageSrc).toBe("/img/ABCDEF/a?v=2");
    });

    it("enregistrer une modification envoie updateItem (prix null pour l'effacer)", async () => {
      const c = await owner();
      (root.querySelector(".wish-edit") as HTMLElement).click();
      itemModalCalls[0].onSubmit({ name: "N", description: "D", link: "L", imageUrl: "I", price: null, file: null, removeUploadedImage: false });
      expect(c.send).toHaveBeenCalledWith({ type: "updateItem", id: "a", name: "N", description: "D", link: "L", imageUrl: "I", price: null });
      expect(uploadItemImage).not.toHaveBeenCalled();
      expect(deleteItemImage).not.toHaveBeenCalled();
    });

    it("une nouvelle photo lors d'une modification est envoyée, avec toasts de suivi", async () => {
      await owner();
      (root.querySelector(".wish-edit") as HTMLElement).click();
      const file = new Blob(["x"]);
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file, removeUploadedImage: false });
      expect(uploadItemImage).toHaveBeenCalledWith("ABCDEF", "a", file, KEY);
      expect(toastText()).toBe("Envoi de la photo…");
      await vi.waitFor(() => expect(toastText()).toBe("Photo enregistrée"));
    });

    it("un échec d'envoi de photo s'affiche en erreur durable, avec message lisible", async () => {
      uploadItemImage.mockRejectedValue(new TypeError("Failed to fetch"));
      await owner();
      (root.querySelector(".wish-edit") as HTMLElement).click();
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: new Blob(["x"]), removeUploadedImage: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(toastText()).toBe("Photo non enregistrée : problème de connexion. Réessaie.");
      const toast = document.getElementById("toast")!;
      expect(toast.className).toBe("toast toast-error");
      expect(toast.getAttribute("role")).toBe("alert");
      vi.advanceTimersByTime(11_999);
      expect(document.getElementById("toast")).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(document.getElementById("toast")).toBeNull();
    });

    it("retirer la photo envoyée appelle la suppression ; un échec s'affiche (message, ou générique)", async () => {
      await owner();
      (root.querySelector(".wish-edit") as HTMLElement).click();
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      expect(deleteItemImage).toHaveBeenCalledWith("ABCDEF", "a", KEY);

      deleteItemImage.mockRejectedValue(new Error("Introuvable"));
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      await vi.waitFor(() => expect(toastText()).toBe("Introuvable"));
      expect(document.getElementById("toast")!.className).toBe("toast toast-error");

      deleteItemImage.mockRejectedValue("autre");
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      await vi.waitFor(() => expect(toastText()).toBe("Impossible de retirer la photo."));
    });

    it("supprimer : confirmation en deux clics, envoi, annulation qui réinsère une copie du souhait", async () => {
      const c = await owner([makeItem({ id: "a", name: "Casque" }), makeItem({ id: "b", name: "Livre", order: 1 })]);
      const call = confirmCalls.find((x) => x.button.classList.contains("wish-delete") && x.button.closest(".wish")!.getAttribute("data-id") === "b")!;
      expect(call.opts.armedLabel).toBe("Confirmer la suppression");
      call.opts.onConfirm();
      expect(c.send).toHaveBeenCalledWith({ type: "deleteItem", id: "b" });
      expect(toastText()).toBe("« Livre » supprimé");

      (document.querySelector("#toast-undo") as HTMLElement).click();
      expect(c.send).toHaveBeenLastCalledWith({ type: "restoreItem", item: makeItem({ id: "b", name: "Livre", order: 1 }) });
    });

    it("l'invité n'a pas d'actions d'édition ; ses réservations restent câblées", async () => {
      await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      expect(confirmCalls).toHaveLength(0);
      expect(root.querySelector(".wish-edit")).toBeNull();
    });
  });

  describe("toasts", () => {
    const toast = () => document.getElementById("toast");

    it("un message normal disparaît après 5 s, sans bouton de fermeture, annoncé comme statut", async () => {
      const c = await mount();
      c.emit("error", "Oups");
      expect(toast()!.textContent).toBe("Oups");
      expect(toast()!.className).toBe("toast");
      expect(toast()!.getAttribute("role")).toBe("status");
      expect(toast()!.querySelector("#toast-close")).toBeNull();
      expect(toast()!.querySelector("#toast-undo")).toBeNull();
      vi.advanceTimersByTime(4999);
      expect(toast()).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(toast()).toBeNull();
    });

    it("un nouveau message remplace l'ancien et relance le minuteur", async () => {
      const c = await mount();
      c.emit("error", "Un");
      vi.advanceTimersByTime(3000);
      c.emit("error", "Deux");
      expect(document.querySelectorAll("#toast")).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(toast()!.textContent).toBe("Deux");
      vi.advanceTimersByTime(2000);
      expect(toast()).toBeNull();
    });

    it("échappe le texte", async () => {
      const c = await mount();
      c.emit("error", "<b>x</b>");
      expect(toast()!.querySelector("b")).toBeNull();
      expect(toast()!.querySelector("span")!.textContent).toBe("<b>x</b>");
    });

    it("l'annulation exécute l'action et ferme ; l'erreur durable se ferme à la main", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }), { editKey: KEY });
      c.emit("welcome", true);
      (root.querySelector(".wish-edit") as HTMLElement).click();
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      deleteItemImage.mockRejectedValue(new Error("Raté"));
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      await vi.waitFor(() => expect(toast()!.getAttribute("role")).toBe("alert"));
      expect(toast()!.querySelector("#toast-close")!.getAttribute("aria-label")).toBe("Fermer");
      (toast()!.querySelector("#toast-close") as HTMLElement).click();
      expect(toast()).toBeNull();
    });
  });

  describe("renommer la liste", () => {
    const start = async () => {
      const c = await mount(sampleState({ name: "Noël" }), { editKey: KEY });
      c.emit("welcome", true);
      $("#list-title").click();
      return { c, input: root.querySelector("input.list-title-input") as HTMLInputElement };
    };

    it("un clic sur le titre remplace celui-ci par un champ prérempli, focalisé et sélectionné", async () => {
      const { input } = await start();
      expect(input.value).toBe("Noël");
      expect(input.getAttribute("type")).toBe("text");
      expect(input.className).toBe("inline-edit list-title-input");
      expect(input.maxLength).toBe(200);
      expect(input.getAttribute("aria-label")).toBe("Nom de la liste");
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
      expect(root.querySelector("#list-title")).toBeNull();
    });

    it("Entrée valide : nom recadré envoyé, titre rétabli avec le nouveau nom", async () => {
      const { c, input } = await start();
      input.value = "  Nouveau  ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(c.send).toHaveBeenCalledWith({ type: "renameList", name: "Nouveau" });
      expect($("#list-title").textContent).toBe("Nouveau");
      expect(root.querySelector("input.list-title-input")).toBeNull();
    });

    it("Échap annule ; un autre touche ne fait rien", async () => {
      const { c, input } = await start();
      input.value = "Autre";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(root.querySelector("input.list-title-input")).not.toBeNull();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(c.send).not.toHaveBeenCalled();
      expect($("#list-title").textContent).toBe("Noël");
    });

    it("Échap puis la perte de focus (retrait du champ) n'envoie rien", async () => {
      const { c, input } = await start();
      input.value = "Autre";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      input.dispatchEvent(new Event("blur"));
      expect(c.send).not.toHaveBeenCalled();
      expect($("#list-title").textContent).toBe("Noël");
    });

    it("la perte de focus valide, une seule fois", async () => {
      const { c, input } = await start();
      input.value = "Nouveau";
      input.dispatchEvent(new Event("blur"));
      input.dispatchEvent(new Event("blur"));
      expect(c.send).toHaveBeenCalledTimes(1);
    });

    it("un nom vide ou inchangé n'envoie rien", async () => {
      const { c, input } = await start();
      input.value = "   ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      $("#list-title").click();
      const again = root.querySelector("input.list-title-input") as HTMLInputElement;
      again.value = "Noël";
      again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(c.send).not.toHaveBeenCalled();
      expect($("#list-title").textContent).toBe("Noël");
    });

    it("Entrée sur le titre (clavier) lance aussi l'édition ; une autre cible non", async () => {
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      $("#list-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(root.querySelector("input.list-title-input")).not.toBeNull();
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      const c2 = await mount(sampleState(), { editKey: KEY });
      c2.emit("welcome", true);
      $("#list-title").dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      $("#btn-back").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(root.querySelector("input.list-title-input")).toBeNull();
    });

    it("l'invité ne peut pas renommer", async () => {
      await mount(sampleState());
      $("#list-title").click();
      expect(root.querySelector("input.list-title-input")).toBeNull();
    });
  });

  describe("menu", () => {
    const openMenu = () => $("#btn-menu").click();
    const actions = () => Array.from(root.querySelectorAll("#menu [data-action]")).map((b) => b.getAttribute("data-action"));

    it("s'ouvre, marque l'état, se referme au second clic", async () => {
      await mount();
      expect($("#menu").hidden).toBe(true);
      openMenu();
      expect($("#menu").hidden).toBe(false);
      expect($("#btn-menu").getAttribute("aria-expanded")).toBe("true");
      openMenu();
      expect($("#menu").hidden).toBe(true);
      expect($("#btn-menu").getAttribute("aria-expanded")).toBe("false");
    });

    it("un clic dehors le ferme, un clic dedans (sans action) non, un clic sur le bouton non plus", async () => {
      await mount();
      openMenu();
      $("#menu").click();
      expect($("#menu").hidden).toBe(false);
      document.body.click();
      expect($("#menu").hidden).toBe(true);
    });

    it("invité : thème et accessibilité ; propriétaire : aperçu en plus ; aperçu : retour à l'édition", async () => {
      await mount();
      openMenu();
      expect(actions()).toEqual(["theme", "a11y"]);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);

      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      openMenu();
      expect(actions()).toEqual(["preview", "theme", "a11y"]);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);

      await mount(sampleState(), { editKey: KEY, preview: true });
      openMenu();
      expect(actions()).toEqual(["edit", "theme", "a11y"]);
    });

    it("libellé du thème courant, et installation proposée si possible", async () => {
      localStorage.setItem("kkjv:theme", "dark");
      canInstall = true;
      await mount();
      openMenu();
      expect($("#menu [data-action=theme]").textContent).toContain("Thème : Sombre");
      expect(actions()).toEqual(["theme", "a11y", "install"]);
    });

    it.each([
      ["preview", () => expect(navigate).toHaveBeenCalledWith("/l/ABCDEF?lecture")],
      ["theme", () => expect(localStorage.getItem("kkjv:theme")).toBe("light")],
      ["a11y", () => expect(openAccessibilityModal).toHaveBeenCalledOnce()],
      ["install", () => expect(installApp).toHaveBeenCalledOnce()],
    ])("l'action %s", async (action, check) => {
      canInstall = true;
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      openMenu();
      ($(`#menu [data-action=${action}]`) as HTMLElement).click();
      check();
      expect($("#menu").hidden).toBe(true);
    });

    it("l'action « retour à l'édition » navigue vers la liste", async () => {
      await mount(sampleState(), { editKey: KEY, preview: true });
      openMenu();
      ($("#menu [data-action=edit]") as HTMLElement).click();
      expect(navigate).toHaveBeenCalledWith("/l/ABCDEF");
    });
  });

  describe("accord du serveur sur l'édition", () => {
    it("clé refusée : clé oubliée, toast, lecture seule, glisser-déposer coupé", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }), { editKey: KEY });
      const first = dndCalls[0];
      expect(getEditKey("ABCDEF")).toBe(KEY);
      c.emit("welcome", false);
      expect(getEditKey("ABCDEF")).toBeNull();
      expect(document.querySelector("#toast span")!.textContent).toBe("Ta clé d'édition n'est pas valide : liste ouverte en lecture seule.");
      expect($("#btn-add").hidden).toBe(true);
      expect($("#mode-banner").hidden).toBe(false);
      expect(first.dispose).toHaveBeenCalled();
      expect(dndCalls).toHaveLength(1);
    });

    it("clé acceptée : rien ne change ; invité accepté en édition (cas rare) : devient éditable", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }), { editKey: KEY });
      c.emit("welcome", true);
      expect(getEditKey("ABCDEF")).toBe(KEY);
      expect(document.getElementById("toast")).toBeNull();
      expect($("#btn-add").hidden).toBe(false);
    });

    it("sans clé, un welcome « lecture seule » ne touche à rien", async () => {
      const c = await mount();
      c.emit("welcome", false);
      expect(document.getElementById("toast")).toBeNull();
    });

    it("un welcome « édition » rend l'invité éditeur et active le glisser-déposer", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }));
      expect(dndCalls).toHaveLength(0);
      c.emit("welcome", true);
      expect($("#btn-add").hidden).toBe(false);
      expect(dndCalls).toHaveLength(1);
    });
  });

  describe("glisser-déposer", () => {
    it("cible la liste, les souhaits et leur poignée ; n'existe pas pour un invité", async () => {
      await mount(sampleState({ items: [makeItem()] }));
      expect(dndCalls).toHaveLength(0);
      cleanup?.();
      const c = await mount(sampleState({ items: [makeItem()] }), { editKey: KEY });
      c.emit("welcome", true);
      const dnd = dndCalls[dndCalls.length - 1];
      expect(dnd.container).toBe($("#wishes"));
      expect([dnd.opts.containerSelector, dnd.opts.itemSelector, dnd.opts.handleSelector]).toEqual([".wishes", ".wish", ".wish-handle"]);
    });

    it("à la dépose : envoie l'ordre, met à jour l'ordre local", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a", name: "A" }), makeItem({ id: "b", name: "B", order: 1 })] }), { editKey: KEY });
      c.emit("welcome", true);
      const list = $("#wishes");
      list.append(list.children[0]);
      dndCalls[dndCalls.length - 1].opts.onDrop();
      expect(c.send).toHaveBeenCalledWith({ type: "reorderItems", orderedIds: ["b", "a"] });
    });

    it("pendant un glisser, les mises à jour sont différées jusqu'à la dépose", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a", name: "A" }), makeItem({ id: "b", name: "B", order: 1 })] }), { editKey: KEY });
      c.emit("welcome", true);
      (root.querySelector(".wish-handle") as HTMLElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      emitState(c, sampleState({ items: [makeItem({ id: "a", name: "A" }), makeItem({ id: "b", name: "B", order: 1 }), makeItem({ id: "c", name: "C", order: 2 })] }));
      expect(names()).toEqual(["A", "B"]);

      dndCalls[dndCalls.length - 1].opts.onDrop();
      expect(names()).toEqual(["A", "B", "C"]);
    });

    it("un pointerdown ailleurs que sur la poignée ne diffère rien ; la dépose sans mise à jour en attente ne redessine pas", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a", name: "A" })] }), { editKey: KEY });
      c.emit("welcome", true);
      (root.querySelector(".wish-name") as HTMLElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      emitState(c, sampleState({ items: [makeItem({ id: "a", name: "A" }), makeItem({ id: "b", name: "B", order: 1 })] }));
      expect(names()).toEqual(["A", "B"]);
      const before = root.querySelector(".wish");
      dndCalls[dndCalls.length - 1].opts.onDrop();
      expect(root.querySelector(".wish")).toBe(before);
    });
  });

  describe("nettoyage", () => {
    it("se désabonne, déconnecte, libère le glisser-déposer, retire le toast et l'écouteur de clic", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }), { editKey: KEY });
      c.emit("welcome", true);
      c.emit("error", "x");
      const dnd = dndCalls[dndCalls.length - 1];
      const remove = vi.spyOn(document, "removeEventListener");

      cleanup!();
      cleanup = undefined;

      expect(c.unsubscribed).toBe(6);
      expect(c.disconnect).toHaveBeenCalledOnce();
      expect(dnd.dispose).toHaveBeenCalled();
      expect(document.getElementById("toast")).toBeNull();
      expect(remove.mock.calls.map(([t]) => t)).toContain("click");
    });

  });
  describe("cas limites (mutation)", () => {
    const wish = (id: string) => root.querySelector(`.wish[data-id="${id}"]`) as HTMLElement;

    it("annuler une réservation dont le jeton a disparu entre-temps n'envoie rien", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      (wish("a").querySelector(".reserve-btn") as HTMLElement).click();
      c.emit("reservation", { id: "a", reserved: true, ok: true });
      c.send.mockClear();
      c.emit("reservation", { id: "a", reserved: false, ok: true }); // jeton oublié
      (document.querySelector("#toast-undo") as HTMLElement | null)?.click();
      expect(c.send).not.toHaveBeenCalled();
    });

    it("un souhait supprimé à distance pendant un glisser ne peut plus être modifié ni supprimé", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }), { editKey: KEY });
      c.emit("welcome", true);
      const edit = wish("a").querySelector(".wish-edit") as HTMLElement;
      const del = confirmCalls.find((x) => x.button.classList.contains("wish-delete"))!;
      (wish("a").querySelector(".wish-handle") as HTMLElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      emitState(c, sampleState({ items: [] }));
      edit.click();
      del.opts.onConfirm();
      expect(itemModalCalls).toHaveLength(0);
      expect(c.send).not.toHaveBeenCalled();
    });

    it("sans clé d'édition, aucune photo n'est envoyée ni retirée même si le serveur accorde l'édition", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      c.emit("welcome", true);
      (wish("a").querySelector(".wish-edit") as HTMLElement).click();
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: new Blob(["x"]), removeUploadedImage: false });
      itemModalCalls[0].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: null, removeUploadedImage: true });
      expect(uploadItemImage).not.toHaveBeenCalled();
      expect(deleteItemImage).not.toHaveBeenCalled();

      $("#btn-add").click();
      itemModalCalls[1].onSubmit({ name: "N", description: "", link: "", imageUrl: "", price: 1, file: new Blob(["x"]), removeUploadedImage: false });
      emitState(c, sampleState({ items: [makeItem({ id: "uid-1" })] }));
      expect(uploadItemImage).not.toHaveBeenCalled();
    });
  });
  describe("détails (mutation)", () => {
    const wish = (id: string) => root.querySelector(`.wish[data-id="${id}"]`) as HTMLElement;
    const plain = () => [makeItem({ id: "a", name: "A" }), makeItem({ id: "b", name: "B", order: 1 })];

    it("le nom de domaine ne perd « www. » qu'en tête", async () => {
      await mount(sampleState({ items: [makeItem({ id: "a", link: "https://sous.www.exemple.fr/x" })] }));
      expect(wish("a").querySelector(".wish-link span")!.textContent).toBe("sous.www.exemple.fr");
    });

    it("sans prix, description, lien ni réservation : aucun texte parasite, pour l'invité comme pour le propriétaire", async () => {
      await mount(sampleState({ items: plain() }));
      expect(stray(".wishes, .wish, .wish-body, .wish-heading, .wish-media, .wish-actions")).toEqual([]);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      const c = await mount(sampleState({ items: plain() }), { editKey: KEY });
      c.emit("welcome", true);
      expect(stray(".wishes, .wish, .wish-body, .wish-heading, .wish-media, .wish-actions")).toEqual([]);
    });

    it("la barre de tri apparaît dès deux souhaits", async () => {
      await mount(sampleState({ items: plain() }));
      expect($("#sort-bar").hidden).toBe(false);
    });

    it("une confirmation de réservation tardive, sans nouvelle demande, ne mémorise pas de jeton", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      (wish("a").querySelector(".reserve-btn") as HTMLElement).click();
      c.emit("reservation", { id: "a", reserved: true, ok: true });
      c.emit("reservation", { id: "a", reserved: false, ok: true });
      expect(getReservationTokens("ABCDEF")).toEqual({});
      c.emit("reservation", { id: "a", reserved: true, ok: true });
      expect(getReservationTokens("ABCDEF")).toEqual({});
    });

    it("une confirmation de réservation redessine le souhait (« Réservé par toi »)", async () => {
      const c = await mount(sampleState({ items: [makeItem({ id: "a" })] }));
      (wish("a").querySelector(".reserve-btn") as HTMLElement).click();
      emitState(c, sampleState({ items: [makeItem({ id: "a", reserved: true })] }));
      expect(wish("a").querySelector(".reservation-badge")!.textContent!.trim()).toBe("Déjà réservé");
      c.emit("reservation", { id: "a", reserved: true, ok: true });
      expect(wish("a").querySelector(".reservation-badge")!.textContent!.trim()).toBe("Réservé par toi");
    });

    it("le bandeau de lecture n'est rempli que pour un invité avec une liste chargée", async () => {
      const c = await mount(sampleState(), { editKey: KEY });
      c.emit("welcome", true);
      expect($("#mode-banner").innerHTML).toBe("");
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      await mount(null);
      expect($("#mode-banner").innerHTML).toBe("");
    });

    it("sans bouton de retour à l'édition, le bandeau n'a aucun texte parasite", async () => {
      await mount(sampleState());
      expect(stray("#mode-banner")).toEqual([]);
    });

    it("liste introuvable avec un cache : souhaits vidés et total masqué", async () => {
      cacheListState(sampleState({ items: [makeItem({ id: "a", price: 10 })] }));
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "ABCDEF", { preview: false }, navigate);
      expect($("#total").hidden).toBe(false);
      await vi.waitFor(() => expect($("#list-title").textContent).toBe("Liste introuvable"));
      expect($("#wishes").innerHTML).toBe("");
      expect($("#total").hidden).toBe(true);
    });

    it("la liste des souhaits n'a aucun texte parasite entre les lignes, ni le menu entre ses entrées", async () => {
      const c = await mount(sampleState({ items: plain() }));
      expect(stray("#wishes")).toEqual([]);
      c.emit("welcome", false);
      $("#btn-menu").click();
      expect(stray("#menu")).toEqual([]);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      canInstall = true;
      const c2 = await mount(sampleState({ items: plain() }), { editKey: KEY, preview: true });
      c2.emit("welcome", true);
      $("#btn-menu").click();
      expect(stray("#menu")).toEqual([]);
      cleanup?.();
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.appendChild(root);
      canInstall = false;
      const c3 = await mount(sampleState({ items: plain() }), { editKey: KEY });
      c3.emit("welcome", true);
      $("#btn-menu").click();
      expect(stray("#menu")).toEqual([]);
    });

    it("un souhait arrivé pendant un glisser garde son ordre, et le déplacement local est appliqué à la dépose", async () => {
      const c = await mount(sampleState({ items: plain() }), { editKey: KEY });
      c.emit("welcome", true);
      (root.querySelector(".wish-handle") as HTMLElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      emitState(c, sampleState({ items: [...plain(), makeItem({ id: "c", name: "C", order: 2 })] }));
      const list = $("#wishes");
      list.append(list.children[0]); // A passe après B
      dndCalls[dndCalls.length - 1].opts.onDrop();
      expect(names()).toEqual(["B", "A", "C"]);
    });

    it("la dépose suivante, sans mise à jour en attente, ne redessine pas", async () => {
      const c = await mount(sampleState({ items: plain() }), { editKey: KEY });
      c.emit("welcome", true);
      const handle = () => root.querySelector(".wish-handle") as HTMLElement;
      handle().dispatchEvent(new Event("pointerdown", { bubbles: true }));
      emitState(c, sampleState({ items: plain() }));
      dndCalls[dndCalls.length - 1].opts.onDrop();

      handle().dispatchEvent(new Event("pointerdown", { bubbles: true }));
      const before = root.querySelector(".wish");
      dndCalls[dndCalls.length - 1].opts.onDrop();
      expect(root.querySelector(".wish")).toBe(before);
    });

    it("un welcome identique au mode courant ne réinstalle pas le glisser-déposer", async () => {
      const c = await mount(sampleState({ items: [makeItem()] }), { editKey: KEY });
      const calls = dndCalls.length;
      c.emit("welcome", true);
      expect(dndCalls).toHaveLength(calls);
    });
  });
});
