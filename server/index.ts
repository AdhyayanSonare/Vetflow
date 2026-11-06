import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { getPool } from "./db/pool";
import { mountClient } from "./http/static";

async function main() {
  const production = process.env.NODE_ENV === "production";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. See .env.example.");
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

  const pool = getPool();
  await pool.query("select 1"); // fail early with a clear message if the database is unreachable
  const app = createApp(pool, { production, relaxCsp: !production });
  const server = createServer(app);

  // Unknown API paths are JSON 404s. Everything else is the single-page app.
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found." } }));
  await mountClient(app, server, production);

  server.on("error", err => { console.error("Server failed:", err.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Vetflow listening on port ${port}`));

  const stop = () => { server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
