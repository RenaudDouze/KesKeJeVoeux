# KesKeJeVoeux

Une liste de souhaits à partager en **lecture seule**, sur le même modèle
que [DansMaHotte](https://github.com/RenaudDouze/DansMaHotte) : hébergée
entièrement sur Cloudflare (Workers + Durable Objects + R2, sans base de
données externe), synchronisée en temps réel.

## Fonctionnalités

- **Une simple liste de souhaits**, sans catégories : chaque souhait a un
  nom, une description, un prix, un lien et une image (photo envoyée, ou
  adresse d'une image en ligne). Les photos sont redimensionnées et
  compressées dans le navigateur avant l'envoi (5 Mo max côté serveur).
- **Total** des prix renseignés.
- **Réordonnancement** par glisser-déposer (souris et tactile).
- **Partage en lecture seule** : le lien (ou code, ou QR code) partagé ne
  permet que de consulter la liste. Les invités n'ont aucun moyen de passer
  en mode édition — le serveur refuse toute modification qui ne porte pas
  la clé d'édition, même envoyée à la main sur le WebSocket.
- **Réservations secrètes** : en mode lecture, un invité peut réserver un
  souhait (« Je le réserve ») pour éviter les doublons ; les autres invités
  le voient « Déjà réservé ». Le propriétaire de la liste ne voit jamais les
  réservations — elles ne lui sont même pas envoyées, y compris dans son
  aperçu invité. Seul l'appareil qui a réservé peut annuler.
- **Compteur de personnes connectées** en temps réel, affiché dans
  l'en-tête et dans la bannière du mode lecture.
- **Mises à jour en direct** : les invités voient les changements
  instantanément.
- **Lien d'édition** personnel (dans la modale de partage, replié) pour
  ouvrir sa liste en édition sur un autre appareil.
- **Aperçu invité** : depuis le menu ⋮, voir sa liste exactement comme la
  voient les invités.
- **Annulation** d'une suppression pendant 5 secondes.
- **Installable sur téléphone** (PWA) : bouton « Installer l'app » sur
  l'accueil et dans le menu ⋮ — invite native sur Android/Chrome, marche à
  suivre sur iPhone/iPad (Safari → Partager → Sur l'écran d'accueil).
  L'interface se relance instantanément, même hors ligne.
- Thème clair/sombre/auto, réglages d'accessibilité.

## Modèle d'accès

Chaque liste a deux identifiants :

| | Format | Donne accès à | Où il vit |
|---|---|---|---|
| **Code** | 6 caractères (`/l/CODE`) | lecture seule | partagé librement |
| **Clé d'édition** | 32 caractères hexadécimaux | modification | navigateur du créateur (`localStorage`) ; seule son empreinte SHA-256 est stockée côté serveur |

- La clé est générée à la création de la liste et renvoyée une seule fois
  au créateur. Elle n'apparaît jamais dans l'état de la liste diffusé aux
  personnes connectées.
- Le lien d'édition porte la clé dans le fragment d'URL (`/l/CODE#cle=…`),
  jamais envoyé au serveur ; l'app la mémorise puis la retire aussitôt de la
  barre d'adresse.
- Le Durable Object marque chaque connexion WebSocket comme `editor` ou
  `viewer` à l'ouverture (clé vérifiée) et rejette tout message de
  modification venant d'un `viewer`. Les routes d'écriture d'image exigent
  aussi la clé (en-tête `x-edit-key`).
- **Perdre la clé = perdre le droit de modifier** : garde le lien d'édition
  quelque part si tu changes d'appareil ou vides ton navigateur.

Les données de chaque liste sont chiffrées au repos (AES-GCM, clé dérivée du
code — voir `worker/crypto.ts`) : ça protège contre un accès direct au
stockage brut, pas contre quelqu'un qui a le code. Les images envoyées
(bucket R2) ne sont pas chiffrées. Toute personne qui a le code peut **voir**
la liste.

## Démarrer en local

```bash
npm install
npm run dev
```

## Qualité

```bash
npm run lint
npm run typecheck
npm run test:coverage   # Vitest — logique pure (shared/, worker/ sauf listRoom.ts, src/lib/price.ts, src/lib/editLink.ts), 100 % de couverture
npm run test:e2e        # Playwright, contre `vite dev`
```

## Déployer

- **Cloudflare** : `npm run deploy` (connecté via `npx wrangler login`, avec
  un bucket R2 `keskejevoeux-item-images`), ou automatiquement via
  `.github/workflows/deploy.yml` après une CI verte sur `main` (secrets
  `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`, variable optionnelle
  `DEPLOY_URL`).
- **GitHub Pages** : `.github/workflows/pages.yml`, une fois Pages activé
  (Settings → Pages → Source : « GitHub Actions »). Le client pointe alors
  vers le Worker Cloudflare via `VITE_SYNC_WORKER_URL`.

## Structure

```
worker/      Worker Cloudflare (routes API), Durable Object ListRoom,
             reducer.ts (logique pure), access.ts (code, clé d'édition)
shared/      Types partagés (état, protocole WebSocket)
src/         Client sans framework : vues accueil / liste, modales
e2e/         Tests Playwright (édition, lecture seule, présence…)
```
