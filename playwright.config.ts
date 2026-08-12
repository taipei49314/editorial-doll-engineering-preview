import { defineConfig, devices } from "@playwright/test";

const studioPort = 43_173;
const studioUrl = `http://127.0.0.1:${studioPort}`;

export default defineConfig({
  testDir: "./apps/studio/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: studioUrl,
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
      `pnpm --filter @editorial-doll/studio dev --host 127.0.0.1 --port ${studioPort}`,
    url: studioUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
