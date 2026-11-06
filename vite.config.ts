import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  root: path.resolve(root, "client"),
  publicDir: path.resolve(root, "client", "public"),
  envDir: root,
  build: {
    outDir: path.resolve(root, "dist", "public"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Charts are only needed on two pages, so they load on demand.
        manualChunks: {
          react: ["react", "react-dom", "wouter"],
          query: ["@tanstack/react-query"],
          charts: ["recharts"],
        },
      },
    },
  },
  // Running `vite` alone (without the Express server) proxies the API to it.
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
});
