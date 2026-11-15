// Chaque module est associé aux seuls fichiers de test capables de tuer ses
// mutants : la CI lance un job par module (variable MUTATE, voir
// .github/scripts/mutation-matrix.mjs) et le runner « command » ne relance que
// ces tests-là pour chaque mutant, au lieu de toute la liste. Un fichier trop
// long (src/views/list.ts) est découpé en plages de lignes (`fichier:début-fin`),
// un job chacune. Exclus, comme de la couverture : shared/types.ts (types seuls)
// et worker/listRoom.ts (couche Durable Object, couverte par les tests e2e).
export const targets = {
  'worker/access.ts': ['worker/access.test.ts'],
  'worker/crypto.ts': ['worker/crypto.test.ts'],
  'worker/index.ts': ['worker/index.test.ts'],
  'worker/reducer.ts': ['worker/reducer.test.ts'],
  'worker/reservations.ts': ['worker/reservations.test.ts'],
  'src/lib/accessibilityPreference.ts': ['src/lib/accessibilityPreference.test.ts'],
  'src/lib/basePath.ts': ['src/lib/basePath.test.ts'],
  'src/lib/confirmClick.ts': ['src/lib/confirmClick.test.ts'],
  'src/lib/dnd.ts': ['src/lib/dnd.test.ts'],
  'src/lib/dom.ts': ['src/lib/dom.test.ts'],
  'src/lib/editLink.ts': ['src/lib/editLink.test.ts'],
  'src/lib/focusTrap.ts': ['src/lib/focusTrap.test.ts'],
  'src/lib/http.ts': ['src/lib/http.test.ts'],
  'src/lib/icons.ts': ['src/lib/icons.test.ts'],
  'src/lib/id.ts': ['src/lib/id.test.ts'],
  'src/lib/imageSize.ts': ['src/lib/imageSize.test.ts'],
  'src/lib/install.ts': ['src/lib/install.test.ts'],
  'src/lib/prepareImage.ts': ['src/lib/prepareImage.test.ts'],
  'src/lib/price.ts': ['src/lib/price.test.ts'],
  'src/lib/sortItems.ts': ['src/lib/sortItems.test.ts'],
  'src/lib/sortPreference.ts': ['src/lib/sortPreference.test.ts'],
  'src/lib/storage.ts': ['src/lib/storage.test.ts'],
  'src/lib/syncWorker.ts': ['src/lib/syncWorker.test.ts'],
  'src/lib/theme.ts': ['src/lib/theme.test.ts'],
  'src/lib/ws.ts': ['src/lib/ws.test.ts'],
  'src/components/accessibilityModal.ts': ['src/components/accessibilityModal.test.ts'],
  'src/components/installModal.ts': ['src/components/installModal.test.ts'],
  'src/components/itemModal.ts': ['src/components/itemModal.test.ts'],
  'src/components/qr.ts': ['src/components/qr.test.ts'],
  'src/components/shareModal.ts': ['src/components/shareModal.test.ts'],
  'src/main.ts': ['src/main.test.ts'],
  'src/views/home.ts': ['src/views/home.test.ts'],
  'src/views/list.ts:1-160': ['src/views/list.test.ts'],
  'src/views/list.ts:161-320': ['src/views/list.test.ts'],
  'src/views/list.ts:321-480': ['src/views/list.test.ts'],
  'src/views/list.ts:481-635': ['src/views/list.test.ts'],
};

const selected = process.env.MUTATE ? process.env.MUTATE.split(',') : Object.keys(targets);
for (const file of selected) {
  if (!targets[file]) throw new Error(`MUTATE : module inconnu ${file}`);
}
const tests = [...new Set(selected.flatMap((file) => targets[file]))];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // Le runner "vitest" de Stryker exécute presque aucun test par mutant dans
  // ces projets (score quasi nul, faux survivants) : on relance une commande
  // `vitest run` fixe par mutant (runner "command"), même choix que KoiKiManke.
  testRunner: "command",
  commandRunner: { command: `npx vitest run ${tests.join(' ')}` },
  coverageAnalysis: "off",
  // Le préprocesseur tsconfig de Stryker appelle une API retirée de
  // TypeScript 7 (`ts.parseConfigFileTextToJson`) et plante au démarrage :
  // pointer vers un fichier inexistant le rend inopérant.
  tsconfigFile: "tsconfig.stryker-unused.json",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "mutation-report/index.html" },
  // Tout le code testé : worker, utilitaires, composants et vues (voir
  // `targets` en tête de fichier).
  mutate: selected,
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
