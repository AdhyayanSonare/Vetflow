import express, { type Express } from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";

/** Production serves the built client. Development runs Vite in middleware mode. */
export async function mountClient(app: Express, server: Server, production: boolean) {
  if (!production) {
    const { createServer: createVite } = await import("vite");
    const root = path.resolve(import.meta.dirname, "..");
    const vite = await createVite({
      configFile: path.join(root, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
    return;
  }
  const dist = path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(dist)) throw new Error(`Client build not found at ${dist}. Run pnpm build first.`);
  // Hashed assets are immutable. index.html is never cached so a new release shows up at once.
  app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(dist, "index.html")));
}
