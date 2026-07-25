import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web/src"),
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/render": "http://localhost:8082",
      "/bot-check": "http://localhost:8082",
      "/health": "http://localhost:8082",
    },
  },
});
