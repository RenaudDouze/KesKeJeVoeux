import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Voir worker/test/cloudflareWorkersShim.ts.
      "cloudflare:workers": path.resolve(import.meta.dirname, "worker/test/cloudflareWorkersShim.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Seul le sous-ensemble de logique pure est testé unitairement ; le
      // code DOM (src/views, src/components, glue réseau/stockage) est
      // couvert par les tests e2e Playwright.
      include: ["shared/**/*.ts", "worker/**/*.ts", "src/lib/price.ts", "src/lib/editLink.ts", "src/lib/imageSize.ts"],
      exclude: [
        "**/*.test.ts",
        "worker/test/**",
        // Fichier de types uniquement.
        "shared/types.ts",
        // Glue du Durable Object (stockage, hibernation WebSocket) : vérifiée
        // par les tests e2e contre une vraie instance `vite dev`. Toute sa
        // logique métier vit dans reducer.ts / access.ts, testés à 100 %.
        "worker/listRoom.ts",
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
