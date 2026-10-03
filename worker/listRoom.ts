import { DurableObject } from "cloudflare:workers";
import type { ListState, ClientMessage, ServerMessage } from "../shared/types";
import { applyMessage, isAllowedFromClient } from "./reducer";
import { verifyEditKey } from "./access";
import { deriveKey, encryptWithKey, decryptWithKey, type EncryptedPayload } from "./crypto";

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
}

const STATE_KEY = "state";
const EDIT_KEY_HASH_KEY = "editKeyHash";
const EDITOR_TAG = "editor";
const VIEWER_TAG = "viewer";

type StoredRecord = { encrypted: true } & EncryptedPayload;

export class ListRoom extends DurableObject<Env> {
  private listState: ListState | null = null;
  private editKeyHash: string | null = null;
  private loaded = false;
  // Le code ne change jamais pour une instance donnée (c'est son identité,
  // voir idFromName dans worker/index.ts) : la clé de chiffrement dérivée
  // est mise en cache plutôt que recalculée à chaque persistance.
  private cryptoKey: CryptoKey | null = null;

  private async getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) this.cryptoKey = await deriveKey(this.ctx.id.name!);
    return this.cryptoKey;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.ctx.storage.get<StoredRecord>(STATE_KEY);
    this.listState = raw ? await decryptWithKey<ListState>(await this.getCryptoKey(), raw) : null;
    this.editKeyHash = (await this.ctx.storage.get<string>(EDIT_KEY_HASH_KEY)) ?? null;
    this.loaded = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    // Le worker transmet la requête d'origine telle quelle pour l'upgrade
    // WebSocket (nécessaire au handshake) : on la reconnaît à son en-tête,
    // pas à son chemin.
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.listState) return new Response("not found", { status: 404 });
      const canEdit = await verifyEditKey(url.searchParams.get("key"), this.editKeyHash);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [canEdit ? EDITOR_TAG : VIEWER_TAG]);
      this.send(server, { type: "welcome", canEdit });
      this.send(server, { type: "state", state: this.listState });
      this.broadcastPresence();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname === "/init") {
      if (this.listState) return Response.json({ error: "exists" }, { status: 409 });
      const body = await request.json<{ code: string; name?: string; editKeyHash: string }>();
      const now = Date.now();
      this.listState = {
        code: body.code,
        name: (body.name ?? "").trim().slice(0, 200) || "Ma liste de souhaits",
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      this.editKeyHash = body.editKeyHash;
      await this.ctx.storage.put(EDIT_KEY_HASH_KEY, this.editKeyHash);
      await this.persist();
      return Response.json(this.listState);
    }

    if (request.method === "POST" && url.pathname === "/check-key") {
      if (!this.listState) return Response.json({ error: "not found" }, { status: 404 });
      const body = await request.json<{ key?: string }>().catch(() => ({}) as { key?: string });
      const ok = await verifyEditKey(body.key, this.editKeyHash);
      return ok ? new Response(null, { status: 204 }) : Response.json({ error: "forbidden" }, { status: 403 });
    }

    // Appelé par le worker après un upload/suppression d'image en R2 (clé
    // d'édition déjà vérifiée via /check-key) : rejoue le message par le
    // même chemin que s'il venait d'un client — même validation, même
    // persistance, même diffusion.
    if (request.method === "POST" && url.pathname === "/apply") {
      if (!this.listState) return Response.json({ error: "not found" }, { status: 404 });
      let msg: ClientMessage;
      try {
        msg = await request.json<ClientMessage>();
      } catch {
        return Response.json({ error: "bad request" }, { status: 400 });
      }
      await this.applyAndBroadcast(msg);
      return Response.json(this.listState);
    }

    if (request.method === "GET") {
      if (!this.listState) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(this.listState);
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoaded();
    if (!this.listState || typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const canEdit = this.ctx.getTags(ws).includes(EDITOR_TAG);
    if (!isAllowedFromClient(msg, canEdit)) {
      this.send(ws, { type: "error", message: "Cette liste est en lecture seule." });
      return;
    }
    if (msg.type === "sync") {
      this.send(ws, { type: "state", state: this.listState });
      return;
    }

    try {
      await this.applyAndBroadcast(msg);
    } catch (err) {
      this.send(ws, { type: "error", message: err instanceof Error ? err.message : "Erreur inconnue" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // déjà fermée
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket morte, l'API d'hibernation s'en occupe
    }
  }

  /** `leaving` : la socket en cours de fermeture, qui peut encore figurer
   * dans getWebSockets() pendant son propre webSocketClose. */
  private broadcastPresence(leaving?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== leaving && s.readyState === WebSocket.OPEN);
    const payload: ServerMessage = { type: "presence", count: sockets.length };
    for (const ws of sockets) this.send(ws, payload);
  }

  private async applyAndBroadcast(msg: ClientMessage): Promise<void> {
    applyMessage(this.listState!, msg);
    await this.persist();
    const payload: ServerMessage = { type: "state", state: this.listState! };
    for (const ws of this.ctx.getWebSockets()) this.send(ws, payload);
  }

  private async persist(): Promise<void> {
    if (!this.listState) return;
    this.listState.updatedAt = Date.now();
    const payload = await encryptWithKey(await this.getCryptoKey(), this.listState);
    await this.ctx.storage.put<StoredRecord>(STATE_KEY, { encrypted: true, ...payload });
  }
}
