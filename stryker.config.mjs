// Fichiers de test qui couvrent le périmètre muté ci-dessous. Liste figée à
// la main (pas un glob) pour rester synchronisée avec `mutate` : ajouter un
// fichier à `mutate` sans son test ici ferait survivre tous ses mutants.
const tests = [
  "worker/access.test.ts",
  "worker/crypto.test.ts",
  "worker/index.test.ts",
  "worker/reducer.test.ts",
  "worker/reservations.test.ts",
  "src/lib/editLink.test.ts",
  "src/lib/imageSize.test.ts",
  "src/lib/price.test.ts",
  "src/lib/sortItems.test.ts",
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // Le runner "vitest" de Stryker exécute presque aucun test par mutant dans
  // ces projets (score quasi nul, faux survivants) : on relance une commande
  // `vitest run` fixe par mutant (runner "command"), même choix que KoiKiManke.
  testRunner: "command",
  commandRunner: { command: `npx vitest run ${tests.join(" ")}` },
  coverageAnalysis: "off",
  // Le préprocesseur tsconfig de Stryker appelle une API retirée de
  // TypeScript 7 (`ts.parseConfigFileTextToJson`) et plante au démarrage :
  // pointer vers un fichier inexistant le rend inopérant.
  tsconfigFile: "tsconfig.stryker-unused.json",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "mutation-report/index.html" },
  // Logique pure uniquement (accès, réservations, réducteur, utilitaires
  // client) : la glue Durable Object et le DOM relèvent de l'e2e.
  mutate: [
    "worker/**/*.ts",
    "src/lib/price.ts",
    "src/lib/editLink.ts",
    "src/lib/imageSize.ts",
    "src/lib/sortItems.ts",
    "!worker/listRoom.ts",
    "!worker/test/**",
    "!**/*.test.ts",
  ],
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  thresholds: { high: 95, low: 85, break: 80 },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
