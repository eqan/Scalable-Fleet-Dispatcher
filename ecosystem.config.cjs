/**
 * PM2 Ecosystem Configuration
 *
 * Loads environment variables from the monorepo root .env file
 * and passes them to both the API server and the Worker process.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart ecosystem.config.cjs
 *   pm2 stop ecosystem.config.cjs
 *   pm2 delete ecosystem.config.cjs
 */

const { readFileSync } = require("fs");
const { resolve } = require("path");

/* ---- Parse .env file into an object ---- */
function loadEnv(filePath) {
  const env = {};
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      env[key] = value;
    }
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err.message);
    process.exit(1);
  }
  return env;
}

const ROOT = __dirname;
const envVars = loadEnv(resolve(ROOT, ".env"));

module.exports = {
  apps: [
    {
      name: "dispatch-api",
      interpreter: "bun",
      script: "src/bootstrap.ts",
      cwd: resolve(ROOT, "apps/api"),
      env: envVars,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "dispatch-worker",
      interpreter: "bun",
      script: "src/worker.ts",
      cwd: resolve(ROOT, "apps/api"),
      env: envVars,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
