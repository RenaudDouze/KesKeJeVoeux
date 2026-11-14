import { describe, it, expect, vi } from "vitest";
import worker from "./index";
import { hashEditKey, isWellFormedEditKey } from "./access";

type Env = Parameters<typeof worker.fetch>[1];
type IncomingRequest = Parameters<typeof worker.fetch>[0];
type FetchArg = string | Request;
type FakeHandler = (code: string, input: FetchArg, init?: RequestInit) => Promise<Response> | Response;

// Le handler attend un `Request<CfProperties>` (requête entrante), alors que
// `new Request()` produit une requête sortante : même objet à l'exécution.
function req(url: string, init?: RequestInit): IncomingRequest {
  return new Request(url, init) as unknown as IncomingRequest;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function makeListRoomNamespace(handler: FakeHandler): Env["LIST_ROOM"] {
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: (input: FetchArg, init?: RequestInit) => handler(id, input, init),
    }),
  } as unknown as Env["LIST_ROOM"];
}

function pathOf(input: FetchArg): string {
  return new URL(typeof input === "string" ? input : input.url).pathname;
}

interface FakeR2Object {
  body: BodyInit;
  httpMetadata?: { contentType?: string };
}

function makeItemImages(initial: Record<string, FakeR2Object> = {}) {
  const store = { ...initial };
  const bucket = {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      store[key] = { body: bytes, httpMetadata: opts?.httpMetadata };
    },
    delete: async (key: string) => {
      delete store[key];
    },
  };
  return { bucket: bucket as unknown as Env["ITEM_IMAGES"], store };
}

function makeRateLimiter(success = true): Env["IMAGE_WRITE_RATE_LIMITER"] {
  return { limit: async () => ({ success }) } as unknown as Env["IMAGE_WRITE_RATE_LIMITER"];
}

function makeEnv(
  handler: FakeHandler,
  opts: {
    itemImages?: Env["ITEM_IMAGES"];
    imageRateLimiter?: Env["IMAGE_WRITE_RATE_LIMITER"];
    lookupRateLimiter?: Env["LIST_LOOKUP_RATE_LIMITER"];
    createRateLimiter?: Env["LIST_CREATE_RATE_LIMITER"];
  } = {},
): Env {
  return {
    LIST_ROOM: makeListRoomNamespace(handler),
    ASSETS: { fetch: () => new Response("asset", { status: 200 }) },
    ITEM_IMAGES: opts.itemImages ?? makeItemImages().bucket,
    IMAGE_WRITE_RATE_LIMITER: opts.imageRateLimiter ?? makeRateLimiter(),
    LIST_LOOKUP_RATE_LIMITER: opts.lookupRateLimiter ?? makeRateLimiter(),
    LIST_CREATE_RATE_LIMITER: opts.createRateLimiter ?? makeRateLimiter(),
  } as unknown as Env;
}

function emptyListState(code: string) {
  return { code, name: "Ma liste de souhaits", items: [], createdAt: 0, updatedAt: 0 };
}

const WITH_IP = { "CF-Connecting-IP": "1.2.3.4" };

describe("OPTIONS (préflight CORS)", () => {
  it("répond 204 avec les en-têtes CORS, dont l'en-tête de clé d'édition", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "OPTIONS" }), makeEnv(() => new Response()));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-edit-key");
  });
});

describe("POST /api/lists (création)", () => {
  it("crée une liste et renvoie son état et la clé d'édition (seule son empreinte part au Durable Object)", async () => {
    let initBody: { code: string; name?: string; editKeyHash: string } | null = null;
    const handler: FakeHandler = (code, input, init) => {
      expect(pathOf(input)).toBe("/init");
      initBody = JSON.parse(init!.body as string);
      return Response.json({ ...emptyListState(code), name: initBody!.name });
    };
    const res = await worker.fetch(
      req("https://app.example/api/lists", { method: "POST", body: JSON.stringify({ name: "Anniversaire" }) }),
      makeEnv(handler),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { name: string; code: string }; editKey: string };
    expect(body.state.name).toBe("Anniversaire");
    expect(isWellFormedEditKey(body.editKey)).toBe(true);
    expect(initBody!.code).toBe(body.state.code);
    expect(initBody!.editKeyHash).toBe(await hashEditKey(body.editKey));
    expect(JSON.stringify(initBody)).not.toContain(body.editKey);
  });

  it("tolère un corps absent ou un nom non textuel", async () => {
    let initName: unknown = "unset";
    const handler: FakeHandler = (code, _input, init) => {
      initName = JSON.parse(init!.body as string).name;
      return Response.json(emptyListState(code));
    };
    const env = makeEnv(handler);
    expect((await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), env)).status).toBe(200);
    expect(initName).toBeUndefined();
    await worker.fetch(req("https://app.example/api/lists", { method: "POST", body: JSON.stringify({ name: 3 }) }), env);
    expect(initName).toBeUndefined();
  });

  it("retente avec un autre code tant que le code est déjà pris", async () => {
    const codes: string[] = [];
    const handler: FakeHandler = (code) => {
      codes.push(code);
      return codes.length < 3 ? Response.json({ error: "exists" }, { status: 409 }) : Response.json(emptyListState(code));
    };
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(handler));
    expect(res.status).toBe(200);
    expect(codes).toHaveLength(3);
  });

  it("abandonne après 5 collisions", async () => {
    let attempts = 0;
    const handler: FakeHandler = () => {
      attempts++;
      return Response.json({ error: "exists" }, { status: 409 });
    };
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(handler));
    expect(res.status).toBe(503);
    expect(attempts).toBe(5);
  });

  it("relaie une autre erreur du Durable Object", async () => {
    const res = await worker.fetch(
      req("https://app.example/api/lists", { method: "POST" }),
      makeEnv(() => Response.json({ error: "boom" }, { status: 500 })),
    );
    expect(res.status).toBe(500);
  });

  it("est limité en débit par IP", async () => {
    const res = await worker.fetch(
      req("https://app.example/api/lists", { method: "POST", headers: WITH_IP }),
      makeEnv(() => new Response(), { createRateLimiter: makeRateLimiter(false) }),
    );
    expect(res.status).toBe(429);
  });

  it("laisse passer quand le limiteur accepte l'IP", async () => {
    const res = await worker.fetch(
      req("https://app.example/api/lists", { method: "POST", headers: WITH_IP }),
      makeEnv((code) => Response.json(emptyListState(code))),
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/lists/:code", () => {
  it("renvoie l'état de la liste (code normalisé en majuscules)", async () => {
    let seenCode = "";
    const handler: FakeHandler = (code, input) => {
      seenCode = code;
      expect(pathOf(input)).toBe("/state");
      return Response.json(emptyListState(code));
    };
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef"), makeEnv(handler));
    expect(res.status).toBe(200);
    expect(seenCode).toBe("ABCDEF");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await readJson(res)).code).toBe("ABCDEF");
  });

  it("relaie le 404 d'une liste inconnue", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABCDEF"), makeEnv(() => Response.json({}, { status: 404 })));
    expect(res.status).toBe(404);
  });

  it("refuse les autres méthodes", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABCDEF", { method: "DELETE" }), makeEnv(() => new Response()));
    expect(res.status).toBe(405);
  });

  it("est limité en débit (JSON pour les routes HTTP, texte pour le WebSocket)", async () => {
    const env = makeEnv(() => new Response(), { lookupRateLimiter: makeRateLimiter(false) });
    const res = await worker.fetch(req("https://app.example/api/lists/ABCDEF", { headers: WITH_IP }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/json");
    const ws = await worker.fetch(req("https://app.example/api/lists/ABCDEF/ws", { headers: WITH_IP }), env);
    expect(ws.status).toBe(429);
    expect(await ws.text()).toContain("Trop de tentatives");
  });
});

describe("GET /api/lists/:code/ws", () => {
  it("transmet la requête d'origine telle quelle pour un upgrade WebSocket", async () => {
    let forwarded: FetchArg | null = null;
    const handler: FakeHandler = (_code, input) => {
      forwarded = input;
      return new Response("upgraded", { status: 200 });
    };
    const request = req("https://app.example/api/lists/ABCDEF/ws?key=abc", { headers: { Upgrade: "websocket" } });
    const res = await worker.fetch(request, makeEnv(handler));
    expect(await res.text()).toBe("upgraded");
    expect(forwarded).toBe(request);
  });

  it("refuse une requête ordinaire (jamais transmise au Durable Object)", async () => {
    let called = false;
    const res = await worker.fetch(
      req("https://app.example/api/lists/ABCDEF/ws", { method: "POST" }),
      makeEnv(() => {
        called = true;
        return new Response();
      }),
    );
    expect(res.status).toBe(426);
    expect(called).toBe(false);
  });
});

describe("POST /api/lists/:code/check-key", () => {
  it("renvoie ok quand le Durable Object valide la clé", async () => {
    let sentKey: unknown;
    const handler: FakeHandler = (_code, input, init) => {
      expect(pathOf(input)).toBe("/check-key");
      sentKey = JSON.parse(init!.body as string).key;
      return new Response(null, { status: 204 });
    };
    const res = await worker.fetch(
      req("https://app.example/api/lists/ABCDEF/check-key", { method: "POST", body: JSON.stringify({ key: "k" }) }),
      makeEnv(handler),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(sentKey).toBe("k");
  });

  it("relaie le refus (403) et tolère un corps invalide", async () => {
    const res = await worker.fetch(
      req("https://app.example/api/lists/ABCDEF/check-key", { method: "POST", body: "pas du json" }),
      makeEnv(() => Response.json({ error: "forbidden" }, { status: 403 })),
    );
    expect(res.status).toBe(403);
  });

  it("refuse GET", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABCDEF/check-key"), makeEnv(() => new Response()));
    expect(res.status).toBe(405);
  });
});

describe("/api/lists/:code/items/:id/image", () => {
  const url = "https://app.example/api/lists/abcdef/items/item-1/image";

  function editorHandler(applied: unknown[] = []): FakeHandler {
    return (code, input, init) => {
      if (pathOf(input) === "/check-key") {
        const key = JSON.parse(init!.body as string).key;
        return key === "bonne-cle" ? new Response(null, { status: 204 }) : Response.json({}, { status: 403 });
      }
      if (pathOf(input) === "/apply") {
        applied.push(JSON.parse(init!.body as string));
        return Response.json(emptyListState(code));
      }
      throw new Error(`unexpected path ${pathOf(input)}`);
    };
  }

  it("GET sert l'image stockée avec un cache long", async () => {
    const { bucket } = makeItemImages({ "items/ABCDEF/item-1": { body: "img", httpMetadata: { contentType: "image/png" } } });
    const res = await worker.fetch(req(url), makeEnv(() => new Response(), { itemImages: bucket }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("img");
  });

  it("GET sans type stocké retombe sur application/octet-stream", async () => {
    const { bucket } = makeItemImages({ "items/ABCDEF/item-1": { body: "img" } });
    const res = await worker.fetch(req(url), makeEnv(() => new Response(), { itemImages: bucket }));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("GET renvoie 404 sans image", async () => {
    const res = await worker.fetch(req(url), makeEnv(() => new Response()));
    expect(res.status).toBe(404);
  });

  it("PUT avec la bonne clé stocke l'image puis prévient le Durable Object", async () => {
    const applied: unknown[] = [];
    const { bucket, store } = makeItemImages();
    const res = await worker.fetch(
      req(url, { method: "PUT", body: "png-bytes", headers: { "content-type": "image/png", "x-edit-key": "bonne-cle" } }),
      makeEnv(editorHandler(applied), { itemImages: bucket }),
    );
    expect(res.status).toBe(200);
    expect(store["items/ABCDEF/item-1"].httpMetadata?.contentType).toBe("image/png");
    expect(applied).toEqual([{ type: "setItemImage", id: "item-1", hasImage: true }]);
  });

  it("PUT sans clé (ou avec une mauvaise clé) est refusé sans toucher à R2", async () => {
    const { bucket, store } = makeItemImages();
    const env = makeEnv(editorHandler(), { itemImages: bucket });
    const noKey = await worker.fetch(req(url, { method: "PUT", body: "x", headers: { "content-type": "image/png" } }), env);
    expect(noKey.status).toBe(403);
    const badKey = await worker.fetch(
      req(url, { method: "PUT", body: "x", headers: { "content-type": "image/png", "x-edit-key": "mauvaise" } }),
      env,
    );
    expect(badKey.status).toBe(403);
    expect(store).toEqual({});
  });

  it("PUT sur une liste inconnue renvoie 404", async () => {
    const res = await worker.fetch(
      req(url, { method: "PUT", body: "x", headers: { "content-type": "image/png", "x-edit-key": "k" } }),
      makeEnv(() => Response.json({}, { status: 404 })),
    );
    expect(res.status).toBe(404);
  });

  it("PUT refuse un type non supporté ou absent", async () => {
    const env = makeEnv(editorHandler());
    const svg = await worker.fetch(
      req(url, { method: "PUT", body: "<svg/>", headers: { "content-type": "image/svg+xml", "x-edit-key": "bonne-cle" } }),
      env,
    );
    expect(svg.status).toBe(415);
    const none = await worker.fetch(req(url, { method: "PUT", body: new Uint8Array([1]), headers: { "x-edit-key": "bonne-cle" } }), env);
    expect(none.status).toBe(415);
  });

  it("PUT refuse une image trop grosse (en-tête déclaré ou taille réelle)", async () => {
    const env = makeEnv(editorHandler());
    const declared = await worker.fetch(
      req(url, {
        method: "PUT",
        body: "x",
        headers: { "content-type": "image/png", "x-edit-key": "bonne-cle", "content-length": String(10 * 1024 * 1024) },
      }),
      env,
    );
    expect(declared.status).toBe(413);
    const actual = await worker.fetch(
      req(url, { method: "PUT", body: new Uint8Array(6 * 1024 * 1024), headers: { "content-type": "image/png", "x-edit-key": "bonne-cle" } }),
      env,
    );
    expect(actual.status).toBe(413);
  });

  it("DELETE avec la bonne clé supprime l'image puis prévient le Durable Object", async () => {
    const applied: unknown[] = [];
    const { bucket, store } = makeItemImages({ "items/ABCDEF/item-1": { body: "img" } });
    const res = await worker.fetch(
      req(url, { method: "DELETE", headers: { "x-edit-key": "bonne-cle" } }),
      makeEnv(editorHandler(applied), { itemImages: bucket }),
    );
    expect(res.status).toBe(200);
    expect(store).toEqual({});
    expect(applied).toEqual([{ type: "setItemImage", id: "item-1", hasImage: false }]);
  });

  it("refuse les autres méthodes", async () => {
    const res = await worker.fetch(req(url, { method: "POST" }), makeEnv(editorHandler()));
    expect(res.status).toBe(405);
  });

  it("est limité en débit en écriture", async () => {
    const res = await worker.fetch(
      req(url, { method: "DELETE", headers: { ...WITH_IP, "x-edit-key": "bonne-cle" } }),
      makeEnv(editorHandler(), { imageRateLimiter: makeRateLimiter(false) }),
    );
    expect(res.status).toBe(429);
  });
});

describe("autres routes", () => {
  it("une route /api inconnue renvoie 404", async () => {
    const res = await worker.fetch(req("https://app.example/api/inconnu"), makeEnv(() => new Response()));
    expect(res.status).toBe(404);
  });

  it("le reste est servi par les assets (SPA)", async () => {
    const res = await worker.fetch(req("https://app.example/l/ABCDEF"), makeEnv(() => new Response()));
    expect(await res.text()).toBe("asset");
  });
});

describe("contrat des requêtes envoyées au Durable Object et des réponses", () => {
  const TOO_MANY = "Trop de tentatives, réessaie dans une minute.";
  const KEY = "0123456789abcdef0123456789abcdef";
  const PNG = { "content-type": "image/png" };

  interface Call {
    code: string;
    url: string;
    method?: string;
    body?: unknown;
    contentType?: string | null;
  }

  function recorder(respond: (code: string, url: string) => Response = (code) => Response.json(emptyListState(code))) {
    const calls: Call[] = [];
    const handler: FakeHandler = (code, input, init) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({
        code,
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        contentType: new Headers(init?.headers).get("content-type"),
      });
      return respond(code, url);
    };
    return { calls, handler };
  }

  const editable = (code: string, url: string) => (url.endsWith("/check-key") ? new Response(null, { status: 204 }) : Response.json(emptyListState(code)));

  it("crée une liste : /init en POST JSON avec code, nom et empreinte, réponse JSON", async () => {
    const { calls, handler } = recorder();
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST", body: JSON.stringify({ name: "Noël" }) }), makeEnv(handler));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://list.internal/init", method: "POST", contentType: "application/json" });
    expect(calls[0].body).toMatchObject({ code: calls[0].code, name: "Noël" });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("abandonne après 5 collisions avec le message attendu", async () => {
    const { handler } = recorder(() => new Response("taken", { status: 409 }));
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), makeEnv(handler));
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "Impossible de créer la liste, réessaie." });
  });

  it("GET /api/lists ne crée rien", async () => {
    const { calls, handler } = recorder();
    const res = await worker.fetch(req("https://app.example/api/lists"), makeEnv(handler));
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("préflight CORS : méthodes exactes sous /api/, rien ailleurs", async () => {
    const env = makeEnv(() => new Response());
    const api = await worker.fetch(req("https://app.example/api/lists", { method: "OPTIONS" }), env);
    expect(api.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    const other = await worker.fetch(req("https://app.example/page", { method: "OPTIONS" }), env);
    expect(await other.text()).toBe("asset");
  });

  it("limiteurs : clé IP transmise, requête sans IP jamais bloquée", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const limiter = { limit } as unknown as Env["LIST_CREATE_RATE_LIMITER"];
    await worker.fetch(
      req("https://app.example/api/lists", { method: "POST", headers: { "CF-Connecting-IP": "9.9.9.9" } }),
      makeEnv(recorder().handler, { createRateLimiter: limiter }),
    );
    expect(limit).toHaveBeenCalledWith({ key: "9.9.9.9" });

    const refusing = makeEnv(recorder().handler, { createRateLimiter: makeRateLimiter(false) });
    const noIp = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), refusing);
    expect(noIp.status).toBe(200);
  });

  it("429 : JSON pour les routes HTTP (création, lecture, image), texte pour le WebSocket", async () => {
    const refuse = { createRateLimiter: makeRateLimiter(false), lookupRateLimiter: makeRateLimiter(false), imageRateLimiter: makeRateLimiter(false) };
    const env = makeEnv(recorder().handler, refuse);
    const create = await worker.fetch(req("https://app.example/api/lists", { method: "POST", headers: WITH_IP }), env);
    expect(await readJson(create)).toEqual({ error: TOO_MANY });
    const read = await worker.fetch(req("https://app.example/api/lists/ABCDEF", { headers: WITH_IP }), env);
    expect(await readJson(read)).toEqual({ error: TOO_MANY });
    const checkKey = await worker.fetch(req("https://app.example/api/lists/ABCDEF/check-key", { method: "POST", headers: WITH_IP }), env);
    expect(await readJson(checkKey)).toEqual({ error: TOO_MANY });
    const ws = await worker.fetch(req("https://app.example/api/lists/ABCDEF/ws", { headers: { ...WITH_IP, Upgrade: "websocket" } }), env);
    expect(ws.status).toBe(429);
    expect(await ws.text()).toBe(TOO_MANY);
    const image = await worker.fetch(req("https://app.example/api/lists/ABCDEF/items/i1/image", { method: "DELETE", headers: WITH_IP }), env);
    expect(await readJson(image)).toEqual({ error: TOO_MANY });
  });

  it("ne traite pas un chemin qui contient une route sans la commencer", async () => {
    const { calls, handler } = recorder();
    const env = makeEnv(handler);
    for (const path of ["/x/api/lists/ABCDEF", "/x/api/lists/ABCDEF/items/i1/image"]) {
      const res = await worker.fetch(req(`https://app.example${path}`), env);
      expect(await res.text()).toBe("asset");
    }
    expect(calls).toEqual([]);
  });

  it("WebSocket sans upgrade : 426 « Expected WebSocket »", async () => {
    const res = await worker.fetch(req("https://app.example/api/lists/ABCDEF/ws"), makeEnv(recorder().handler));
    expect(res.status).toBe(426);
    expect(await res.text()).toBe("Expected WebSocket");
  });

  it("check-key : transmis en POST JSON { key } ; POST sur la liste elle-même refusé", async () => {
    const { calls, handler } = recorder(() => new Response(null, { status: 204 }));
    const env = makeEnv(handler);
    await worker.fetch(req("https://app.example/api/lists/abcdef/check-key", { method: "POST", body: JSON.stringify({ key: KEY }) }), env);
    expect(calls).toEqual([{ code: "ABCDEF", url: "https://list.internal/check-key", method: "POST", body: { key: KEY }, contentType: "application/json" }]);

    const post = await worker.fetch(req("https://app.example/api/lists/ABCDEF", { method: "POST", body: "{}" }), env);
    expect(post.status).toBe(405);
    expect(await post.text()).toBe("Method not allowed");
    expect(calls).toHaveLength(1);
  });

  it("lecture d'une liste : /state, JSON, CORS", async () => {
    const { calls, handler } = recorder();
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef"), makeEnv(handler));
    expect(calls).toEqual([expect.objectContaining({ code: "ABCDEF", url: "https://list.internal/state" })]);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("image : suffixe en trop non reconnu, GET absent = 404 « Not found », autre méthode = 405 texte", async () => {
    const env = makeEnv(recorder().handler);
    const extra = await worker.fetch(req("https://app.example/api/lists/ABCDEF/items/i1/image/extra", { method: "PATCH" }), env);
    expect(extra.status).toBe(404);
    const missing = await worker.fetch(req("https://app.example/api/lists/ABCDEF/items/i1/image"), env);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not found");
    const patch = await worker.fetch(req("https://app.example/api/lists/ABCDEF/items/i1/image", { method: "PATCH" }), env);
    expect(patch.status).toBe(405);
    expect(await patch.text()).toBe("Method not allowed");
  });

  it("image PUT : messages d'erreur (404, 403, 415, 413) et limites incluses", async () => {
    const { MAX_IMAGE_BYTES } = await import("../shared/types");
    const url = "https://app.example/api/lists/ABCDEF/items/i1/image";
    const headers = { ...PNG, "x-edit-key": KEY };
    const put = (env: Env, extra: Record<string, string> = {}, body: Uint8Array = new Uint8Array([1])) =>
      worker.fetch(req(url, { method: "PUT", headers: { ...headers, ...extra }, body }), env);

    const unknown = await put(makeEnv(recorder(() => new Response("", { status: 404 })).handler));
    expect(await readJson(unknown)).toEqual({ error: "Liste introuvable." });

    const readOnly = await put(makeEnv(recorder(() => new Response("", { status: 403 })).handler));
    expect(readOnly.status).toBe(403);
    expect(await readJson(readOnly)).toEqual({ error: "Cette liste est en lecture seule." });

    const wrongType = await worker.fetch(req(url, { method: "PUT", headers: { "x-edit-key": KEY, "content-type": "text/html" }, body: new Uint8Array([1]) }), makeEnv(recorder(editable).handler));
    expect(await readJson(wrongType)).toEqual({ error: "Format d'image non supporté." });
    const noType = await worker.fetch(req(url, { method: "PUT", headers: { "x-edit-key": KEY }, body: new Uint8Array([1]) }), makeEnv(recorder(editable).handler));
    expect(noType.status).toBe(415);

    const env = () => makeEnv(recorder(editable).handler);
    expect((await put(env(), { "content-length": String(MAX_IMAGE_BYTES) })).status).toBe(200);
    const declared = await put(env(), { "content-length": String(MAX_IMAGE_BYTES + 1) });
    expect(await readJson(declared)).toEqual({ error: "Image trop volumineuse (5 Mo max)." });
    expect((await put(env(), {}, new Uint8Array(MAX_IMAGE_BYTES))).status).toBe(200);
    const real = await put(env(), {}, new Uint8Array(MAX_IMAGE_BYTES + 1));
    expect(await readJson(real)).toEqual({ error: "Image trop volumineuse (5 Mo max)." });
  });

  it("image PUT/DELETE : vérifie la clé via /check-key puis rejoue setItemImage via /apply, en POST JSON", async () => {
    const { calls, handler } = recorder(editable);
    const env = makeEnv(handler);
    const url = "https://app.example/api/lists/abcdef/items/i1/image";
    await worker.fetch(req(url, { method: "PUT", headers: { ...PNG, "x-edit-key": KEY }, body: new Uint8Array([1]) }), env);
    await worker.fetch(req(url, { method: "DELETE", headers: { "x-edit-key": KEY } }), env);
    const check = { code: "ABCDEF", url: "https://list.internal/check-key", method: "POST", body: { key: KEY }, contentType: "application/json" };
    const apply = (hasImage: boolean) => ({ code: "ABCDEF", url: "https://list.internal/apply", method: "POST", body: { type: "setItemImage", id: "i1", hasImage }, contentType: "application/json" });
    expect(calls).toEqual([check, apply(true), check, apply(false)]);
  });

  it("route /api inconnue : 404 « Not found »", async () => {
    const res = await worker.fetch(req("https://app.example/api/inconnu"), makeEnv(recorder().handler));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
