import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../../server/db/migrate";

const dir = path.resolve(import.meta.dirname, "../../db/migrations");

describe("migrations", () => {
  it("re-running applies nothing", async () => {
    expect(await migrate({ adminUrl: process.env.TEST_ADMIN_URL! })).toEqual([]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    const file = path.join(dir, readdirSync(dir).filter(f => f.endsWith(".sql")).sort()[0]);
    const original = readFileSync(file);
    try {
      appendFileSync(file, "\n-- tampered\n");
      await expect(migrate({ adminUrl: process.env.TEST_ADMIN_URL! })).rejects.toThrow(/changed after it was applied/);
    } finally {
      writeFileSync(file, original);
    }
  });
});
