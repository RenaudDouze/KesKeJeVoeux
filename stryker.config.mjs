// Chaque module est associé aux seuls fichiers de test capables de tuer ses
// mutants : la CI lance un job par module (variable MUTATE, voir
// .github/scripts/mutation-matrix.mjs) et le runner « command » ne relance que
// ces tests-là pour chaque mutant, au lieu de toute la liste.
export const targets = {
  'worker/access.ts': ['worker/access.test.ts'],
  'worker/crypto.ts': ['worker/crypto.test.ts'],
  'worker/index.ts': ['worker/index.test.ts'],
  'worker/reducer.ts': ['worker/reducer.test.ts'],
  'worker/reservations.ts': ['worker/reservations.test.ts'],
  'src/lib/editLink.ts': ['src/lib/editLink.test.ts'],
  'src/lib/imageSize.ts': ['src/lib/imageSize.test.ts'],
  'src/lib/price.ts': ['src/lib/price.test.ts'],
  'src/lib/sortItems.ts': ['src/lib/sortItems.test.ts'],
};

const selected = process.env.MUTATE ? process.env.MUTATE.split(',') : Object.keys(targets);
for (const file of selected) {
  if (!targets[file]) throw new Error(`MUTATE : module inconnu ${file}`);
}
const tests = [...new Set(selected.flatMap((file) => targets[file]))];

// Fichiers de test qui couvrent le périmètre muté ci-dessous. Liste figée à
// la main (pas un glob) pour rester synchronisée avec `mutate` : ajouter un
// fichier à `mutate` sans son test ici ferait survivre tous ses mutants.
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
  // Logique pure uniquement (accès, réservations, réducteur, utilitaires
  // client) : la glue Durable Object et le DOM relèvent de l'e2e.
  mutate: selected,
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
