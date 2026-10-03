import { ListRoom } from "./listRoom";
import { ALLOWED_IMAGE_TYPES, EDIT_KEY_HEADER, MAX_IMAGE_BYTES, type CreateListResponse, type ListState } from "../shared/types";
import { generateCode, generateEditKey, hashEditKey, normalizeCode } from "./access";

export { ListRoom };

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
  ASSETS: Fetcher;
  ITEM_IMAGES: R2Bucket;
  IMAGE_WRITE_RATE_LIMITER: RateLimit;
  // Le code de lecture est court (6 caractères) : sans limite de débit, rien
  // n'empêche de le deviner par force brute pour lire une liste. La clé
  // d'édition, elle, est bien trop longue pour ça.
  LIST_LOOKUP_RATE_LIMITER: RateLimit;
  LIST_CREATE_RATE_LIMITER: RateLimit;
}

// Autorise l'appel depuis une origine différente (client servi par GitHub
// Pages, Worker sur *.workers.dev). Sans objet pour le WebSocket, jamais
// soumis au CORS par les navigateurs.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": `content-type, ${EDIT_KEY_HEADER}`,
};

const TOO_MANY = "Trop de tentatives, réessaie dans une minute.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function jsonPassthrough(res: Response): Promise<Response> {
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}

/** `CF-Connecting-IP` n'existe que sur le réseau Cloudflare (jamais en
 * local/CI) : sans IP, on laisse passer. */
async function isRateLimited(limiter: RateLimit, request: Request): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

function stubFor(env: Env, code: string) {
  return env.LIST_ROOM.get(env.LIST_ROOM.idFromName(code));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/lists" && request.method === "POST") {
      if (await isRateLimited(env.LIST_CREATE_RATE_LIMITER, request)) return jsonError(TOO_MANY, 429);
      const body = await request.json<{ name?: string }>().catch(() => ({}) as { name?: string });
      const editKey = generateEditKey();
      const editKeyHash = await hashEditKey(editKey);

      // /init refuse (409) un code déjà attribué : on retente avec un autre.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        const res = await stubFor(env, code).fetch("https://list.internal/init", {
          method: "POST",
          body: JSON.stringify({ code, name: typeof body.name === "string" ? body.name : undefined, editKeyHash }),
          headers: { "content-type": "application/json" },
        });
        if (res.status === 409) continue;
        if (!res.ok) return jsonPassthrough(res);
        const state = await res.json<ListState>();
        return json({ state, editKey } satisfies CreateListResponse);
      }
      return jsonError("Impossible de créer la liste, réessaie.", 503);
    }

    const listMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})(\/ws|\/check-key)?$/);
    if (listMatch) {
      const code = normalizeCode(listMatch[1]);
      const sub = listMatch[2];

      if (await isRateLimited(env.LIST_LOOKUP_RATE_LIMITER, request)) {
        return sub === "/ws" ? new Response(TOO_MANY, { status: 429 }) : jsonError(TOO_MANY, 429);
      }

      const stub = stubFor(env, code);

      if (sub === "/ws") {
        // Seul un vrai upgrade WebSocket est transmis au Durable Object : une
        // requête ordinaire sur ce chemin n'atteint jamais ses routes internes.
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("Expected WebSocket", { status: 426 });
        }
        // Requête d'origine transmise telle quelle : le handshake en dépend.
        return stub.fetch(request);
      }

      if (sub === "/check-key" && request.method === "POST") {
        const body = await request.json<{ key?: unknown }>().catch(() => ({}) as { key?: unknown });
        const res = await stub.fetch("https://list.internal/check-key", {
          method: "POST",
          body: JSON.stringify({ key: body.key }),
          headers: { "content-type": "application/json" },
        });
        return res.status === 204 ? json({ ok: true }) : jsonPassthrough(res);
      }

      if (!sub && request.method === "GET") {
        return jsonPassthrough(await stub.fetch("https://list.internal/state"));
      }

      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    const imageMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})\/items\/([A-Za-z0-9_-]{1,64})\/image$/);
    if (imageMatch) {
      const code = normalizeCode(imageMatch[1]);
      const itemId = imageMatch[2];
      // Une seule image par souhait : un nouvel upload écrase la précédente.
      const key = `items/${code}/${itemId}`;

      if (request.method === "GET") {
        const object = await env.ITEM_IMAGES.get(key);
        if (!object) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
            // L'URL change de version à chaque remplacement (imageVersion).
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            ...CORS_HEADERS,
          },
        });
      }

      if (request.method !== "PUT" && request.method !== "DELETE") {
        return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
      }

      if (await isRateLimited(env.IMAGE_WRITE_RATE_LIMITER, request)) return jsonError(TOO_MANY, 429);

      const stub = stubFor(env, code);

      // Écrire ou supprimer une image est une modification : il faut la clé
      // d'édition, vérifiée par le Durable Object avant de toucher à R2.
      const check = await stub.fetch("https://list.internal/check-key", {
        method: "POST",
        body: JSON.stringify({ key: request.headers.get(EDIT_KEY_HEADER) }),
        headers: { "content-type": "application/json" },
      });
      if (check.status === 404) return jsonError("Liste introuvable.", 404);
      if (check.status !== 204) return jsonError("Cette liste est en lecture seule.", 403);

      if (request.method === "PUT") {
        const contentType = request.headers.get("content-type") ?? "";
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
          return jsonError("Format d'image non supporté.", 415);
        }
        // En-tête d'abord (rejet rapide), puis taille réelle une fois lue.
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_IMAGE_BYTES) return jsonError("Image trop volumineuse (5 Mo max).", 413);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > MAX_IMAGE_BYTES) return jsonError("Image trop volumineuse (5 Mo max).", 413);
        await env.ITEM_IMAGES.put(key, bytes, { httpMetadata: { contentType } });
      } else {
        await env.ITEM_IMAGES.delete(key);
      }

      const res = await stub.fetch("https://list.internal/apply", {
        method: "POST",
        body: JSON.stringify({ type: "setItemImage", id: itemId, hasImage: request.method === "PUT" }),
        headers: { "content-type": "application/json" },
      });
      return jsonPassthrough(res);
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
