import fs from "node:fs";
import type pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);
const SUPABASE_CA_DEFAULT = "certs/prod-ca-2021.crt";

/**
 * Connection settings for node-postgres. Certificates are always verified.
 *  - Local and Docker-network hosts use no TLS.
 *  - Anything else uses TLS verified against DATABASE_CA_CERT, or the bundled Supabase root CA
 *    for Supabase hosts, or the system trust store.
 * There is deliberately no option to switch verification off.
 */
export function poolConfig(connectionString: string, caCertPath?: string): pg.PoolConfig {
  const url = new URL(connectionString);
  const host = url.hostname;
  url.search = ""; // TLS is configured below; a stale ?sslmode= must not override it
  let ssl: pg.PoolConfig["ssl"] = false;
  if (!LOCAL_HOSTS.has(host)) {
    const path = caCertPath ?? (/\.supabase\.(co|com)$/.test(host) && fs.existsSync(SUPABASE_CA_DEFAULT) ? SUPABASE_CA_DEFAULT : undefined);
    if (path && !fs.existsSync(path)) throw new Error(`DATABASE_CA_CERT points to a file that does not exist: ${path}`);
    ssl = { rejectUnauthorized: true, ...(path ? { ca: fs.readFileSync(path, "utf8") } : {}) };
  }
  return { connectionString: url.toString(), ssl };
}
