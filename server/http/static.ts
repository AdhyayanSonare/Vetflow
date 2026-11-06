import express, { type Express } from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";

/** Where the built client lives: next to the bundled server, or in dist/public when run from source. */
function findClientBuild(): string | undefined {
  return [
    path.resolve(import.meta.dirname, "public"),
    path.resolve(import.meta.dirname, "../../dist/public"),
    path.resolve(process.cwd(), "dist/public"),
  ].find(p => fs.existsSync(path.join(p, "index.html")));
}

/** Production serves the built client. Development runs Vite in middleware mode. */
export async function mountClient(app: Express, server: Server, production: boolean) {
  if (!production) {
    const { createServer: createVite } = await import("vite");
    const root = path.resolve(import.meta.dirname, "../..");
    const vite = await createVite({
      configFile: path.join(root, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
    return;
  }
  const dist = findClientBuild();
  if (!dist) throw new Error("The client build was not found. Run `pnpm build` first (or use `pnpm demo`, which builds it).");
  // Hashed assets are immutable. index.html is never cached so a new release shows up at once.
  app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(dist, "index.html")));
}
