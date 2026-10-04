// Réservations des invités. Volontairement stockées à part de ListState
// (clé de stockage dédiée dans le Durable Object) : l'état de la liste est
// envoyé tel quel au propriétaire, les réservations ne sont ajoutées qu'à la
// vue envoyée aux connexions en lecture seule (viewForRole).

import type { ListState } from "../shared/types";
import { isValidId, type Role } from "./reducer";

/** id du souhait → empreinte SHA-256 du jeton de l'appareil qui a réservé. */
export type Reservations = Record<string, string>;

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{32}$/.test(token);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reservation:${token}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ReservationResult = { ok: true; reservations: Reservations } | { ok: false; error: string };

/** Réserve (ou annule la réservation d') un souhait. Renvoie de nouvelles
 * réservations sans modifier celles reçues. Les réservations de souhaits
 * supprimés depuis sont nettoyées au passage. */
export async function applyReservation(
  state: ListState,
  reservations: Reservations,
  msg: { type: "reserveItem" | "unreserveItem"; id: string; token: string },
): Promise<ReservationResult> {
  if (!isValidId(msg.id) || !state.items.some((i) => i.id === msg.id)) {
    return { ok: false, error: "Ce souhait n'existe plus." };
  }
  if (!isWellFormedToken(msg.token)) return { ok: false, error: "Réservation invalide." };

  const existingIds = new Set(state.items.map((i) => i.id));
  const next: Reservations = {};
  for (const [id, hash] of Object.entries(reservations)) {
    if (existingIds.has(id)) next[id] = hash;
  }

  const hash = await hashToken(msg.token);
  if (msg.type === "reserveItem") {
    if (next[msg.id] && next[msg.id] !== hash) return { ok: false, error: "Ce souhait est déjà réservé par quelqu'un d'autre." };
    next[msg.id] = hash;
  } else {
    if (!next[msg.id]) return { ok: true, reservations: next };
    if (next[msg.id] !== hash) return { ok: false, error: "Seule la personne qui a réservé peut annuler." };
    delete next[msg.id];
  }
  return { ok: true, reservations: next };
}

/** Vue de la liste selon le rôle : le propriétaire (édition ou aperçu)
 * reçoit l'état tel quel, sans aucune réservation ; les invités y voient
 * `reserved: true` sur les souhaits réservés. Jamais l'empreinte elle-même. */
export function viewForRole(state: ListState, reservations: Reservations, role: Role): ListState {
  if (role !== "viewer") return state;
  return { ...state, items: state.items.map((item) => (reservations[item.id] ? { ...item, reserved: true } : item)) };
}
