# CLAUDE.md

## Project

KesKeJeVoeux is a real-time wishlist app forked from the structure of the sibling project DansMaHotte (Cloudflare Workers + Durable Objects + R2, no framework on the client). A list is a flat list of wishes (no categories): name, description, price, link, image (uploaded to R2, or an external image URL). Comments, commit messages and UI are in French; keep that convention.

## Commands

```bash
npm run dev            # vite dev — front + Worker in one process (workerd)
npm run build          # typecheck, then vite build
npm run lint           # oxlint --deny-warnings
npm run typecheck      # tsc against tsconfig.worker.json, then tsconfig.client.json
npm run test:coverage  # vitest, 100% coverage enforced on the files it covers
npm run test:e2e       # playwright, starts its own vite dev server
```

## Access model (the core of this app)

- `code` (6 chars) is public, is the Durable Object's name (`idFromName(code)`), and only grants **read** access.
- `editKey` (32 hex chars) grants **write** access. Generated in `POST /api/lists` (`worker/access.ts`), returned once to the creator, stored server-side only as a SHA-256 hash (`editKeyHash` in DO storage), never part of `ListState`.
- WebSocket: `/api/lists/:code/ws?key=…`. `ListRoom` verifies the key at upgrade time and tags the socket `editor` or `viewer` (hibernation tags). `isAllowedFromClient` (`worker/reducer.ts`) is the single gate: viewers may only send `sync`; `setItemImage` is never accepted from any client (only replayed by the worker after an R2 write).
- Image PUT/DELETE require the `x-edit-key` header, checked through the DO's internal `/check-key` route before touching R2. The worker only forwards real WebSocket upgrades to the DO, so its internal routes (`/init`, `/check-key`, `/apply`) are unreachable from outside.
- Presence: the DO broadcasts `{type:"presence", count}` on every connect/close (all sockets, both modes).
- Client: edit keys live in `localStorage` (`kkjv:editKeys`). The edit link carries the key in the URL fragment (`#cle=…`); `main.ts` saves it and strips it from the address bar. `?lecture` forces the guest view even with a key. The server's `welcome.canEdit` is authoritative — a rejected key is forgotten.

Never weaken this: read-only users must not be able to reach edit mode, and the edit key must never be broadcast.

## PWA

`vite-plugin-pwa` (manifest + service worker, build only). `src/lib/install.ts` captures `beforeinstallprompt` at boot (`main.ts`) to drive the "Installer l'app" button (home + list menu); on iOS there is no prompt, so `src/components/installModal.ts` shows Safari's manual steps. Nothing is offered when already running standalone. Icons in `public/` (maskable variant keeps the glyph in the 80% safe zone).

## Testing

- Unit (Vitest, 100% enforced): `shared/**` (except type-only `types.ts`), `worker/**` (except `listRoom.ts`), `src/lib/price.ts`, `src/lib/editLink.ts`.
- E2E (Playwright, `e2e/`): everything else (DO glue, views, components). Add client behavior tests there.
