import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri v2 expects a fixed dev port and to keep the terminal clean.
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Forward API calls to the `apro-engine-server` host (real Rust computation)
    // when it is running on its default port. Falls back to the in-browser mock
    // only when this proxy target is unreachable.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
