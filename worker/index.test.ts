import { describe, it, expect } from "vitest";
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
