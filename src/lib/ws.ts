import type { ClientMessage, ServerMessage, ListState } from "../../shared/types";
import { wsUrl } from "./syncWorker";

type Listener<T> = (value: T) => void;

/** Connexion temps réel à une liste : reconnexion automatique (backoff
 * exponentiel plafonné), file d'attente des messages pendant une coupure.
 * `editKey` absente = connexion en lecture seule ; le serveur confirme le
 * mode réel via le message "welcome". */
export class ListConnection {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private queue: ClientMessage[] = [];
  private stateListeners = new Set<Listener<ListState>>();
  private errorListeners = new Set<Listener<string>>();
  private connListeners = new Set<Listener<boolean>>();
  private welcomeListeners = new Set<Listener<boolean>>();
  private presenceListeners = new Set<Listener<number>>();
  private reservationListeners = new Set<Listener<{ id: string; reserved: boolean; ok: boolean }>>();

  /** `preview` : le propriétaire regarde sa liste comme un invité — la clé
   * est quand même envoyée, pour que le serveur lui cache les réservations. */
  constructor(
    private code: string,
    private editKey: string | null,
    private preview = false,
  ) {}

  connect(): void {
    this.closedByUser = false;
    const params = new URLSearchParams();
    if (this.editKey) params.set("key", this.editKey);
    if (this.editKey && this.preview) params.set("preview", "1");
    const query = params.size ? `?${params}` : "";
    const ws = new WebSocket(wsUrl(`/api/lists/${encodeURIComponent(this.code)}/ws${query}`));
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      for (const listener of this.connListeners) listener(true);
      for (const msg of this.queue.splice(0)) this.rawSend(msg);
    });

    ws.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type === "state") for (const l of this.stateListeners) l(msg.state);
      else if (msg.type === "welcome") for (const l of this.welcomeListeners) l(msg.canEdit);
      else if (msg.type === "presence") for (const l of this.presenceListeners) l(msg.count);
      else if (msg.type === "reservationResult") for (const l of this.reservationListeners) l(msg);
      else if (msg.type === "error") for (const l of this.errorListeners) l(msg.message);
    });

    ws.addEventListener("close", () => this.scheduleReconnect());
    ws.addEventListener("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    for (const listener of this.connListeners) listener(false);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.7, 15000);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private rawSend(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.rawSend(msg);
    else this.queue.push(msg);
  }

  private subscribe<T>(set: Set<Listener<T>>, listener: Listener<T>): () => void {
    set.add(listener);
    return () => set.delete(listener);
  }

  onState(listener: Listener<ListState>): () => void {
    return this.subscribe(this.stateListeners, listener);
  }

  onError(listener: Listener<string>): () => void {
    return this.subscribe(this.errorListeners, listener);
  }

  onConnectionChange(listener: Listener<boolean>): () => void {
    return this.subscribe(this.connListeners, listener);
  }

  onWelcome(listener: Listener<boolean>): () => void {
    return this.subscribe(this.welcomeListeners, listener);
  }

  onPresence(listener: Listener<number>): () => void {
    return this.subscribe(this.presenceListeners, listener);
  }

  onReservationResult(listener: Listener<{ id: string; reserved: boolean; ok: boolean }>): () => void {
    return this.subscribe(this.reservationListeners, listener);
  }
}
