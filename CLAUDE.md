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

- Reservations (guests reserving a wish): stored apart from `ListState` (`reservations` key in DO storage: itemId → SHA-256 of a per-reservation token kept by the reserving device in `kkjv:reservations`). Socket roles are `editor` / `viewer` / `preview` (owner's "Voir comme un invité": valid key + `?preview=1`). Only `viewer` may reserve, and only `viewer` sockets get `reserved: true` on items (`viewForRole`, `worker/reservations.ts`); HTTP routes never include them. The reserving device learns success via `reservationResult` (sent to it alone). The owner must never receive reservations, in any mode.

Never weaken this: read-only users must not be able to reach edit mode, and the edit key must never be broadcast.

## Photos

Picked photos are never uploaded as-is: `src/lib/prepareImage.ts` decodes them in the browser, resizes to 1600 px max (`fitWithin`, `src/lib/imageSize.ts`) and re-encodes to JPEG, so phone photos (often > 5 MB, or HEIC on iPhone) fit the server limit. Errors must stay visible: picking errors show right under the photo in the item modal; upload results always produce a toast ("Photo enregistrée" or a red error toast with a close button).

## PWA

`vite-plugin-pwa` (manifest + service worker, build only). `src/lib/install.ts` captures `beforeinstallprompt` at boot (`main.ts`) to drive the "Installer l'app" button (home + list menu); on iOS there is no prompt, so `src/components/installModal.ts` shows Safari's manual steps. Nothing is offered when already running standalone. Icons in `public/` (maskable variant keeps the glyph in the 80% safe zone).

## Sorting

Display sort ("Ordre défini" / "Prix ↑" / "Prix ↓") is a per-device preference (`kkjv:sort`, `src/lib/sortPreference.ts`), available to owner and guests alike, never synced and never changing the list's own `order`. `sortItems` (`src/lib/sortItems.ts`) puts unpriced wishes last in both price directions. Drag handles are only rendered in "Ordre défini".

## Testing

- Unit (Vitest, 100% enforced): all of `shared/**` (except type-only `types.ts`), `worker/**` (except `listRoom.ts`) and `src/**` — pure logic under `node`, views/components/DOM glue under `jsdom` (each test file declares `// @vitest-environment jsdom`). Views mock their collaborators (`ws`, `http`, `dnd`, `confirmClick`, modals, `install`) with `vi.mock`.
- Mutation (Stryker, `npm run test:mutation`, `stryker.config.mjs`): same perimeter as the unit coverage; `high`/`low`/`break` thresholds all at 100. An equivalent mutant is handled by simplifying the code (redundant guard, dead default, `?.` on a never-null value, `.trim()` on a `type=url` input), never by lowering the threshold. Uses the `command` runner (the Vitest runner runs ~no tests per mutant) and a missing `tsconfigFile` (Stryker's tsconfig preprocessor crashes on TypeScript 7). `targets` (top of the config) maps each module to the only test files run per mutant; CI runs one job per module (matrix from `.github/scripts/mutation-matrix.mjs`; a long file like `src/views/list.ts` is split into line ranges `'src/views/list.ts:1-160'`, labelled `…@1-160` in artifact names — extend the last range if the file grows). `MUTATE=worker/reducer.ts npm run test:mutation` mutates a single module. A new module must be added to `targets` with its test file. Pitfalls: a selector a mutant breaks silently matches nothing (assert exact attributes/structure); stray text a mutant injects in an HTML template only shows by inspecting text nodes; Docker-run Stryker may leave root-owned files.
- E2E (Playwright, `e2e/`): the app end to end against a real `vite dev` instance (DO glue included); add cross-layer behavior tests there.

## Workflow (owner's standing rule)

No pull request is ever left waiting. For every change: push the branch, open the PR against `main`, wait for CI (all checks green), then rebase-merge it yourself (the `main` ruleset only allows rebase) — without asking. A red CI is fixed and re-pushed, never left open; a check that is red on `main` too (e.g. a new `npm audit` advisory) is fixed in the same PR. This includes Dependabot PRs: whenever you work on the repo, check for open PRs and merge every green one (verify major version bumps don't change the build output first). The session cannot delete remote branches; tell the owner which merged branches remain.

## Documentation, versioning and architecture rules

- `doc/` holds the stable truth for humans and agents: `architecture.md` (executable dependency rules), `codage.md` (conventions), `improvement.md` (backlog).
- `npm run lint` also runs dependency-cruiser (`.dependency-cruiser.cjs`): no cycles, no orphan files, one-way layer dependencies. Document an exception next to the rule, never loosen it globally.
- Commits follow Conventional Commits (`type(scope): subject`); enable the hook with `git config core.hooksPath .githooks`. The version is derived from the commits by semantic-release (`release.yml`): never edit a version number or a changelog by hand.
- Audit (CI-13) : le niveau `high` complet passe par `.github/scripts/audit-check.mjs` ; un avis sans correctif se déclare dans `.github/audit-exceptions.json` (raison + expiration, 30 jours au plus), jamais en baissant le seuil.
- Version affichée (VER-09) : dernier tag `v*`, lu à la construction par `.github/scripts/app-version.mjs` (identique dans tous les dépôts, ne pas le modifier ici) ; `src/lib/appVersion.ts` (constante `__APP_VERSION__` définie dans `vite.config.ts`), affichée au pied de l'accueil (`src/views/home.ts`). Les workflows de build (`pages.yml`, `deploy.yml`) font un checkout en `fetch-depth: 0`, sans quoi la page affiche `dev`. Avant de construire, ces workflows attendent la fin du run Release du commit (`.github/scripts/wait-release.sh`, droit `actions: read`) : sans cela, une CI courte déploie avant la création du tag. Les tests figent la valeur : jamais de dépendance aux tags git.

## PWA: updates and offline

- `registerType: "prompt"` (`vite.config.ts`): a new version is announced, never applied silently. `src/lib/updatePrompt.ts` (pure, dependencies injected) wires `registerSW` to `showUpdateBanner` (`src/components/pwaBanner.ts`); the page reloads only when the user clicks "Recharger".
- `watchOffline()` shows an offline banner while `navigator.onLine` is false.
- `e2e/offline.spec.ts` runs in the `offline` Playwright project against `npm run build && npm run preview` (port 4173): `vite dev` registers no service worker, so offline behaviour can only be tested on the production build.
- `virtual:pwa-register` only exists in a Vite build: Vitest aliases it to `src/test/pwaRegisterShim.ts`.
