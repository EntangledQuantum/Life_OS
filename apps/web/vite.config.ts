import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * Same-origin proxy to the API.
 *
 * This is what makes LAN access work without configuration: the phone loads the
 * app from `http://192.168.x.x:5173` and its `/api` calls go to the same origin,
 * so there is no hard-coded `127.0.0.1` for it to fail on and no CORS round
 * trip. Leave `VITE_API_URL` empty for this to apply.
 */
const proxyToApi = {
  "/api": {
    target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787",
    changeOrigin: true,
  },
  "/health": {
    target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787",
    changeOrigin: true,
  },
};

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/, so the build needs that prefix.
  // Set VITE_BASE=/Life_OS/ for the Pages build; local dev stays at the root.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    /**
     * Bind on every interface so a phone on the same Wi-Fi can load the app.
     * Vite still refuses unknown Host headers, so this is not an open door;
     * `WEB_HOST=localhost` puts it back on loopback only.
     */
    host: process.env.WEB_HOST ?? true,
    proxy: proxyToApi,
  },
  preview: {
    port: 4173,
    host: process.env.WEB_HOST ?? true,
    proxy: proxyToApi,
  },
});
