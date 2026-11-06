import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { sitePassword } from "./sitePassword";

let server: Server;
const start = (password: string) => {
  const app = express();
  app.use(sitePassword(() => password));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/private", (_req, res) => res.send("secret"));
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });

afterEach(() => new Promise(resolve => server.close(resolve)));

describe("sitePassword", () => {
  it("is off when no password is configured", async () => {
    const base = start("");
    expect((await fetch(`${base}/private`)).status).toBe(200);
  });
  it("blocks requests without the password and asks the browser to prompt", async () => {
    const base = start("hunter2");
    const res = await fetch(`${base}/private`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect((await fetch(`${base}/private`, { headers: basic("vet", "wrong") })).status).toBe(401);
    expect((await fetch(`${base}/private`, { headers: { Authorization: "Bearer hunter2" } })).status).toBe(401);
  });
  it("accepts the password with any username, including passwords containing colons", async () => {
    expect((await fetch(`${start("hunter2")}/private`, { headers: basic("anything", "hunter2") })).status).toBe(200);
    await new Promise(resolve => server.close(resolve));
    expect((await fetch(`${start("a:b")}/private`, { headers: basic("x", "a:b") })).status).toBe(200);
  });
  it("keeps the health check open", async () => {
    expect((await fetch(`${start("hunter2")}/api/health`)).status).toBe(200);
  });
});
