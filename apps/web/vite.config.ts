import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from monorepo root so we can read PORT
  const rootEnv = loadEnv(mode, "../../", "");
  const apiPort = rootEnv.PORT || "3000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxy API calls to the backend during development
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
