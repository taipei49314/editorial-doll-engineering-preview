import { fileURLToPath } from "node:url";
import path from "node:path";

import { defineConfig } from "vite";

const studioRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = path.resolve(studioRoot, "../..");

export default defineConfig({
  appType: "spa",
  cacheDir: path.join(workspaceRoot, "node_modules", ".vite-render-harness"),
  root: path.join(workspaceRoot, "packages", "render-engine", "e2e"),
  server: {
    fs: {
      allow: [workspaceRoot],
    },
  },
  resolve: {
    alias: {
      "@editorial-doll/domain": path.join(
        workspaceRoot,
        "packages",
        "domain",
        "src",
        "index.ts",
      ),
    },
  },
});
