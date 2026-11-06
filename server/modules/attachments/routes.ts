import express, { type Express } from "express";
import type pg from "pg";
import { HttpError, notFound, route } from "../../http/route";
import { uuid } from "../../http/schemas";

const MAX_BYTES = 8 * 1024 * 1024;

/** Allowed uploads, identified by their first bytes. The type the client claims is never trusted. */
const SIGNATURES: Array<{ type: string; test: (b: Buffer) => boolean }> = [
  { type: "application/pdf", test: b => b.subarray(0, 4).toString("latin1") === "%PDF" },
  { type: "image/png", test: b => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" },
  { type: "image/jpeg", test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/webp", test: b => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

const safeName = (raw: string | undefined) =>
  (raw ? decodeURIComponent(raw) : "attachment").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "attachment";

export function registerAttachmentRoutes(app: Express, pool: pg.Pool) {
  // Invoice scans and similar files. Raw bytes in the body, the file name in the X-Filename header.
  app.post("/api/attachments", express.raw({ type: () => true, limit: MAX_BYTES }), route(pool, "purchase.write", async ({ c, user, req }) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "invalid_file", "Choose a file to attach.");
    if (body.length > MAX_BYTES) throw new HttpError(413, "too_large", "Files can be up to 8 MB.");
    const sig = SIGNATURES.find(s => s.test(body));
    if (!sig) throw new HttpError(415, "unsupported_type", "Attach a PDF, PNG, JPEG or WebP file.");
    const r = await c.query(
      "insert into attachments (tenant_id, filename, content_type, size_bytes, data, created_by) values ($1,$2,$3,$4,$5,$6) returning id, filename, content_type \"contentType\", size_bytes \"sizeBytes\"",
      [user.tenantId, safeName(req.get("x-filename")), sig.type, body.length, body, user.userId]);
    return r.rows[0];
  }, 201));

  app.get("/api/attachments/:id", route(pool, "catalogue.read", async ({ c, req, res }) => {
    const a = (await c.query("select filename, content_type, data from attachments where id = $1", [uuid.parse(req.params.id)])).rows[0];
    if (!a) throw notFound("Attachment");
    res.set({
      "Content-Type": a.content_type,
      "Content-Disposition": `inline; filename="${String(a.filename).replace(/"/g, "")}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, max-age=300",
    });
    res.send(a.data);
  }));
}
