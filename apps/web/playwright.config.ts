import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the Dispatch web frontend.
 *
 * - Loads the monorepo root .env so the API server picks up the right config
 * - Runs Chromium only (fast CI, covers 90%+ of browser bugs)
 * - Starts both API and Web dev servers before tests
 * - API proxied via Vite config (/api → localhost:PORT)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Load root .env so API env vars  are available */
config({ path: resolve(__dirname, "../../.env") });

const API_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,

  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  /* Start API + Web dev servers before tests */
  webServer: [
    {
      command: "bun run --watch src/bootstrap.ts",
      cwd: resolve(__dirname, "../api"),
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
      },
    },
    {
      command: "bun run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
