import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);

/**
 * End-to-end tests run against the real app: `pnpm demo:reset` starts a throwaway PostgreSQL with the
 * synthetic demo clinic on its own ports, so they never touch the normal demo or any hosted database.
 * Locally the installed Chrome is used. In CI the bundled Chromium is installed with `playwright install`.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "phone", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "pnpm demo:reset --rebuild",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    env: { PORT: String(PORT), DEMO_PG_PORT: "54399", DEMO_DATA_DIR: ".demo-data-e2e", LOG_LEVEL: "error" },
  },
});
