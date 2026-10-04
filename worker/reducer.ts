// Logique pure de mutation d'une liste de souhaits, sortie du Durable Object
// (listRoom.ts) pour être testable sans runtime Workers.

import type { ListState, ClientMessage, Item, ItemFields } from "../shared/types";
import { MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_URL_LENGTH, MAX_ITEMS_PER_LIST } from "../shared/types";

export function nextOrder(list: { order: number }[]): number {
  return list.reduce((max, x) => Math.max(max, x.order), -1) + 1;
}

/** Toujours soit "", soit une URL absolue http(s) — imposé ici et pas
 * seulement côté client, puisqu'un message peut être forgé à la main. Un
 * schéma absent ("monsite.fr") est supposé https ; tout autre schéma
 * (javascript:, data:…) est refusé, ce qui donne "". */
export function normalizeUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().slice(0, MAX_URL_LENGTH);
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Un prix valide est un nombre fini >= 0, arrondi au centime. Renvoie
 * undefined pour une valeur invalide, pour laisser le prix existant intact
 * plutôt que de l'écraser. */
export function normalizePrice(price: unknown): number | undefined {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return undefined;
  return Math.round(price * 100) / 100;
}

function normalizeText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

/** Un id est ensuite interpolé dans un attribut HTML (data-id) côté client :
 * on n'accepte que la forme générée par l'app (uid()). */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function applyFields(item: Item, fields: ItemFields): void {
  if (fields.name !== undefined) {
    const name = normalizeText(fields.name, MAX_NAME_LENGTH);
    if (name) item.name = name;
  }
  if (fields.description !== undefined) item.description = normalizeText(fields.description, MAX_DESCRIPTION_LENGTH);
  if (fields.link !== undefined) item.link = normalizeUrl(fields.link);
  if (fields.imageUrl !== undefined) item.imageUrl = normalizeUrl(fields.imageUrl);
  if (fields.price === null) {
    delete item.price;
  } else if (fields.price !== undefined) {
    const price = normalizePrice(fields.price);
    if (price !== undefined) item.price = price;
  }
}

/** Rôle d'une connexion, fixé à l'ouverture du WebSocket :
 * - "editor" : clé d'édition valide, modifie la liste, ne voit jamais les
 *   réservations ;
 * - "viewer" : invité, lecture seule, voit et fait les réservations ;
 * - "preview" : le propriétaire en « Voir comme un invité » (clé valide mais
 *   aperçu demandé) — lecture seule, et toujours sans les réservations. */
export type Role = "editor" | "viewer" | "preview";

/** Seul "sync" est permis à tous. `setItemImage` n'est jamais accepté d'un
 * client, même éditeur : il n'est émis que par le worker, une fois l'image
 * réellement écrite (ou supprimée) en R2. Les réservations sont réservées
 * aux invités (voir worker/reservations.ts). */
export function isAllowedFromClient(msg: ClientMessage, role: Role): boolean {
  if (msg.type === "sync") return true;
  if (msg.type === "setItemImage") return false;
  if (msg.type === "reserveItem" || msg.type === "unreserveItem") return role === "viewer";
  return role === "editor";
}

/** Applique un message en modifiant `state` sur place. */
export function applyMessage(state: ListState, msg: ClientMessage, now: number = Date.now()): void {
  switch (msg.type) {
    case "sync":
      return;

    case "renameList": {
      const name = normalizeText(msg.name, MAX_NAME_LENGTH);
      if (name) state.name = name;
      return;
    }

    case "addItem": {
      if (state.items.length >= MAX_ITEMS_PER_LIST) return;
      if (!isValidId(msg.id) || state.items.some((i) => i.id === msg.id)) return;
      const name = normalizeText(msg.name, MAX_NAME_LENGTH);
      if (!name) return;
      const item: Item = {
        id: msg.id,
        name,
        description: "",
        link: "",
        imageUrl: "",
        order: nextOrder(state.items),
        createdAt: now,
        updatedAt: now,
        hasImage: false,
        imageVersion: 0,
      };
      applyFields(item, { description: msg.description, link: msg.link, imageUrl: msg.imageUrl, price: msg.price });
      state.items.push(item);
      return;
    }

    case "updateItem": {
      const item = state.items.find((i) => i.id === msg.id);
      if (!item) return;
      applyFields(item, msg);
      item.updatedAt = now;
      return;
    }

    case "deleteItem": {
      state.items = state.items.filter((i) => i.id !== msg.id);
      return;
    }

    case "reorderItems": {
      if (!Array.isArray(msg.orderedIds)) return;
      const order = new Map(msg.orderedIds.map((id, idx) => [id, idx]));
      for (const item of state.items) {
        const idx = order.get(item.id);
        if (idx !== undefined) item.order = idx;
      }
      return;
    }

    case "setItemImage": {
      const item = state.items.find((i) => i.id === msg.id);
      if (!item) return;
      item.hasImage = msg.hasImage;
      item.imageVersion += 1;
      item.updatedAt = now;
      return;
    }

    // Gérés à part (worker/reservations.ts) : ils ne modifient pas l'état
    // de la liste lui-même, seulement les réservations, stockées ailleurs.
    case "reserveItem":
    case "unreserveItem":
      return;

    case "restoreItem": {
      const source = msg.item;
      if (!source || !isValidId(source.id) || state.items.some((i) => i.id === source.id)) return;
      if (state.items.length >= MAX_ITEMS_PER_LIST) return;
      // Recopié champ par champ (et renormalisé) plutôt que tel quel : le
      // contenu vient du client, il ne doit pas pouvoir injecter de champs
      // arbitraires ou contourner la validation.
      const item: Item = {
        id: source.id,
        name: normalizeText(source.name, MAX_NAME_LENGTH) || "Souhait",
        description: "",
        link: "",
        imageUrl: "",
        order: Number.isFinite(source.order) ? source.order : nextOrder(state.items),
        createdAt: Number.isFinite(source.createdAt) ? source.createdAt : now,
        updatedAt: now,
        hasImage: source.hasImage === true,
        imageVersion: Number.isInteger(source.imageVersion) && source.imageVersion >= 0 ? source.imageVersion : 0,
      };
      applyFields(item, {
        description: source.description,
        link: source.link,
        imageUrl: source.imageUrl,
        price: source.price,
      });
      state.items.push(item);
      return;
    }
  }
}
