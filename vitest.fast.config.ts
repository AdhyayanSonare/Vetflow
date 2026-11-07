import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);

/**
 * Tests that need no database, so they start instantly. Used by the Stop hook and `pnpm test:fast`.
 * The full suite (`pnpm test`) starts a real PostgreSQL and covers the API and the database.
 */
export default defineConfig({
  root,
  resolve: { alias: { "@": path.resolve(root, "client", "src"), "@shared": path.resolve(root, "shared") } },
  test: {
    environment: "node",
    include: ["client/src/**/*.test.ts", "tests/unit/config.test.ts", "tests/unit/scripts.test.ts", "tests/unit/asr-clients.test.ts", "tests/unit/eval-metrics.test.ts"],
    testTimeout: 30000,
  },
});
