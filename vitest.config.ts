import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@editorial-doll/catalog": fromRoot("./packages/catalog/src/index.ts"),
      "@editorial-doll/domain": fromRoot("./packages/domain/src/index.ts"),
      "@editorial-doll/render-engine/browser": fromRoot(
        "./packages/render-engine/src/browser.ts",
      ),
      "@editorial-doll/render-engine": fromRoot(
        "./packages/render-engine/src/index.ts",
      ),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "tools/**/*.test.ts"],
    passWithNoTests: false,
  },
});
