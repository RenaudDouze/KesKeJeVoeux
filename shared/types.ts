// Types partagés entre le worker (Durable Object) et le client.

/** Taille max d'une image envoyée pour un souhait (photo ou capture d'écran). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Types d'image acceptés en upload — voir worker/index.ts. Pas de SVG : un
 * SVG peut embarquer du script, un risque inutile pour une simple photo. */
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** En-tête portant la clé d'édition sur les routes HTTP d'écriture (image). */
export const EDIT_KEY_HEADER = "x-edit-key";

/** Longueur max d'un nom (liste, souhait) — tronqué plutôt que rejeté, pour
 * qu'un message forgé ne gonfle pas indéfiniment l'état stocké/diffusé. */
export const MAX_NAME_LENGTH = 200;
/** Même logique pour la description, plus longue par nature. */
export const MAX_DESCRIPTION_LENGTH = 2000;
/** Et pour les URLs (lien, image distante). */
export const MAX_URL_LENGTH = 2000;
/** Nombre max de souhaits par liste. */
export const MAX_ITEMS_PER_LIST = 300;

export interface Item {
  id: string;
  name: string;
  /** Texte libre (taille, couleur, précisions…). Toujours une chaîne,
   * éventuellement vide. */
  description: string;
  /** Lien vers une page web (ex: la fiche produit). Toujours soit vide, soit
   * une URL absolue http(s) — voir normalizeUrl dans worker/reducer.ts. */
  link: string;
  /** Image distante (URL d'image copiée depuis un site), même normalisation
   * que `link`. Ignorée à l'affichage si une image a été envoyée
   * (`hasImage`), qui prime. */
  imageUrl: string;
  /** Prix en euros. Absent = pas de prix renseigné. Toujours un nombre fini
   * >= 0, arrondi au centime. */
  price?: number;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** Image envoyée (stockée en R2, voir /api/lists/:code/items/:id/image).
   * imageVersion s'incrémente à chaque remplacement, pour que l'URL de
   * l'image change et invalide le cache navigateur. */
  hasImage: boolean;
  imageVersion: number;
}

export interface ListState {
  /** Code public de la liste (lecture seule). Ne donne jamais le droit de
   * modifier : il faut pour ça la clé d'édition, qui n'apparaît jamais dans
   * cet état diffusé à tous les connectés. */
  code: string;
  name: string;
  items: Item[];
  createdAt: number;
  updatedAt: number;
}

/** Champs modifiables d'un souhait, communs à l'ajout et à la modification. */
export interface ItemFields {
  name?: string;
  description?: string;
  link?: string;
  imageUrl?: string;
  // null efface le prix ; undefined = champ non fourni, ne touche à rien.
  price?: number | null;
}

export type ClientMessage =
  | { type: "sync" }
  | { type: "renameList"; name: string }
  | ({ type: "addItem"; id: string; name: string } & Omit<ItemFields, "name">)
  | ({ type: "updateItem"; id: string } & ItemFields)
  | { type: "deleteItem"; id: string }
  | { type: "reorderItems"; orderedIds: string[] }
  // Émis par le worker (jamais accepté d'un client) une fois l'upload ou la
  // suppression de l'image effectivement passée en R2 — voir worker/index.ts.
  | { type: "setItemImage"; id: string; hasImage: boolean }
  // Action compensatoire de l'annulation côté client : réinsère exactement
  // le souhait supprimé (même id, même ordre).
  | { type: "restoreItem"; item: Item };

export type ServerMessage =
  | { type: "state"; state: ListState }
  /** Envoyé une fois à la connexion : dit au client s'il a le droit de
   * modifier (clé d'édition valide) ou s'il est en lecture seule. */
  | { type: "welcome"; canEdit: boolean }
  /** Nombre de personnes actuellement connectées à la liste (tous modes
   * confondus), rediffusé à chaque arrivée/départ. */
  | { type: "presence"; count: number }
  | { type: "error"; message: string };

/** Réponse de POST /api/lists : la clé d'édition n'est renvoyée qu'ici, une
 * seule fois, à son créateur. */
export interface CreateListResponse {
  state: ListState;
  editKey: string;
}
