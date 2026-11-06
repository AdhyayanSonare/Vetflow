import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { appUrl, serve } from "../helpers";

let pool: pg.Pool;
beforeAll(() => { pool = new pg.Pool({ connectionString: appUrl(), max: 2 }); });
afterAll(async () => { await pool.end(); });

const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });
async function start(password?: string) {
  const app = createApp(pool, { sitePassword: password });
  app.get("/private", (_req, res) => res.send("secret"));
  return serve(app);
}

describe("shared site password", () => {
  it("is off when no password is configured", async () => {
    const s = await start();
    expect((await s.call("GET", "/api/health")).status).toBe(200);
    expect((await s.call("GET", "/private")).status).toBe(200);
    await s.close();
  });

  it("blocks requests without the password, asks the browser to prompt, and keeps the health check open", async () => {
    const s = await start("hunter2");
    const r = await s.call("GET", "/private");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect((await s.call("POST", "/api/auth/login", { email: "a@b.c", password: "x" })).status).toBe(401);
    expect((await s.call("GET", "/api/health")).status).toBe(200);
    await s.close();
  });

  it("accepts the password with any username, including passwords that contain colons", async () => {
    for (const pw of ["hunter2", "a:b:c"]) {
      const s = await start(pw);
      expect((await s.call("GET", "/private", undefined, { headers: basic("anything", pw) })).status).toBe(200);
      expect((await s.call("GET", "/private", undefined, { headers: basic("anything", pw + "x") })).status).toBe(401);
      expect((await s.call("GET", "/private", undefined, { headers: { Authorization: `Bearer ${pw}` } })).status).toBe(401);
      await s.close();
    }
  });
});
