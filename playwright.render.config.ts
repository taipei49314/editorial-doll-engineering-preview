import { defineConfig, devices } from "@playwright/test";

const renderHarnessPort = 43_174;
const renderHarnessUrl = `http://127.0.0.1:${renderHarnessPort}`;

export default defineConfig({
  testDir: "./packages/render-engine/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: renderHarnessUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      `pnpm --filter @editorial-doll/studio exec vite --config vite.render.config.ts --host 127.0.0.1 --port ${renderHarnessPort}`,
    url: renderHarnessUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
