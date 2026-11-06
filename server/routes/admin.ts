import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { hashPassword, passwordProblem } from "../auth/service";
import { auditTx, ensureOwned, HttpError, notFound, route } from "./helpers";

const uuid = z.string().uuid();
const ROLES = ["admin", "inventory_manager", "pharmacist", "vet", "viewer"] as const;

export function registerAdminRoutes(app: Express, pool: pg.Pool) {
  // Feature flags are readable by every signed-in user so the app can hide what is switched off.
  app.get("/api/features", route(pool, null, async ({ c }) => {
    const s = (await c.query("select voice_enabled, barcode_enabled, asr_default_language from tenant_settings")).rows[0];
    return { voice: !!s?.voice_enabled, barcode: !!s?.barcode_enabled, asrLanguage: s?.asr_default_language ?? "en" };
  }));

  // Settings ------------------------------------------------------------------------------
  const settingsSelect = `voice_enabled "voiceEnabled", barcode_enabled "barcodeEnabled", allow_negative_override "allowNegativeOverride",
    expiry_alert_days "expiryAlertDays", transcript_retention_days "transcriptRetentionDays", keep_audio "keepAudio", asr_default_language "asrDefaultLanguage"`;
  app.get("/api/settings", route(pool, "settings.manage", async ({ c }) =>
    (await c.query(`select ${settingsSelect} from tenant_settings`)).rows[0]));
  app.patch("/api/settings", route(pool, "settings.manage", async ({ c, user, req }) => {
    const b = z.object({
      voiceEnabled: z.boolean(), barcodeEnabled: z.boolean(), allowNegativeOverride: z.boolean(),
      expiryAlertDays: z.array(z.number().int().min(1).max(730)).min(1).max(6),
      transcriptRetentionDays: z.number().int().min(0).max(3650), keepAudio: z.boolean(),
      asrDefaultLanguage: z.enum(["en", "de", "fr", "es", "hi"]),
    }).partial().parse(req.body);
    const before = (await c.query(`select ${settingsSelect} from tenant_settings`)).rows[0];
    await c.query(
      `update tenant_settings set voice_enabled = coalesce($1,voice_enabled), barcode_enabled = coalesce($2,barcode_enabled),
         allow_negative_override = coalesce($3,allow_negative_override), expiry_alert_days = coalesce($4,expiry_alert_days),
         transcript_retention_days = coalesce($5,transcript_retention_days), keep_audio = coalesce($6,keep_audio),
         asr_default_language = coalesce($7,asr_default_language)`,
      [b.voiceEnabled ?? null, b.barcodeEnabled ?? null, b.allowNegativeOverride ?? null, b.expiryAlertDays ?? null,
        b.transcriptRetentionDays ?? null, b.keepAudio ?? null, b.asrDefaultLanguage ?? null]);
    const after = (await c.query(`select ${settingsSelect} from tenant_settings`)).rows[0];
    await c.query("insert into audit_log (tenant_id,user_id,action,entity,before,after) values ($1,$2,'settings.update','tenant_settings',$3,$4)",
      [user.tenantId, user.userId, JSON.stringify(before), JSON.stringify(after)]);
    return after;
  }));

  // Users ----------------------------------------------------------------------------------
  const userSelect = `u.id, u.email, u.name, u.role, u.active, u.created_at "createdAt",
    coalesce((select json_agg(ub.branch_id) from user_branches ub where ub.user_id = u.id), '[]'::json) "branchIds"`;
  app.get("/api/users", route(pool, "users.manage", async ({ c }) =>
    (await c.query(`select ${userSelect} from users u order by u.name`)).rows));

  app.post("/api/users", route(pool, "users.manage", async ({ c, user, req }) => {
    const b = z.object({
      email: z.string().trim().email().max(200), name: z.string().trim().min(1).max(120), role: z.enum(ROLES),
      password: z.string().max(200), branchIds: z.array(uuid).max(50).default([]),
    }).parse(req.body);
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, "weak_password", problem);
    await ensureOwned(c, "branches", b.branchIds);
    try {
      const r = await c.query("insert into users (tenant_id,email,name,password_hash,role) values ($1,$2,$3,$4,$5) returning id",
        [user.tenantId, b.email.toLowerCase(), b.name, await hashPassword(b.password), b.role]);
      for (const br of b.branchIds) await c.query("insert into user_branches (tenant_id,user_id,branch_id) values ($1,$2,$3)", [user.tenantId, r.rows[0].id, br]);
      await auditTx(c, user, "user.create", "user", r.rows[0].id, { email: b.email, role: b.role, branchIds: b.branchIds });
      return (await c.query(`select ${userSelect} from users u where u.id = $1`, [r.rows[0].id])).rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate", "A user with this email already exists.");
      throw e;
    }
  }, 201));

  app.patch("/api/users/:id", route(pool, "users.manage", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ name: z.string().trim().min(1).max(120), role: z.enum(ROLES), active: z.boolean(), branchIds: z.array(uuid).max(50), password: z.string().max(200) }).partial().parse(req.body);
    const before = (await c.query(`select ${userSelect} from users u where u.id = $1`, [id])).rows[0];
    if (!before) throw notFound("User");
    // Never leave the tenant without an active admin, and never let an admin lock themselves out by accident.
    if ((b.role && b.role !== "admin" && before.role === "admin") || (b.active === false && before.role === "admin")) {
      const others = (await c.query("select count(*)::int n from users where role='admin' and active and id <> $1", [id])).rows[0].n;
      if (others === 0) throw new HttpError(409, "last_admin", "There must be at least one active admin.");
    }
    if (b.password) {
      const problem = passwordProblem(b.password);
      if (problem) throw new HttpError(400, "weak_password", problem);
    }
    await ensureOwned(c, "branches", b.branchIds ?? []);
    await c.query(
      `update users set name = coalesce($2,name), role = coalesce($3,role), active = coalesce($4,active),
         password_hash = coalesce($5,password_hash), failed_logins = case when $5::text is not null then 0 else failed_logins end,
         locked_until = case when $5::text is not null then null else locked_until end where id = $1`,
      [id, b.name ?? null, b.role ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null]);
    if (b.branchIds) {
      await c.query("delete from user_branches where user_id = $1", [id]);
      for (const br of b.branchIds) await c.query("insert into user_branches (tenant_id,user_id,branch_id) values ($1,$2,$3)", [user.tenantId, id, br]);
    }
    // A changed role, deactivation or new password ends that user's sessions.
    if (b.role || b.active === false || b.password) await c.query("delete from sessions where user_id = $1", [id]);
    const after = (await c.query(`select ${userSelect} from users u where u.id = $1`, [id])).rows[0];
    await c.query("insert into audit_log (tenant_id,user_id,action,entity,entity_id,before,after) values ($1,$2,'user.update','user',$3,$4,$5)",
      [user.tenantId, user.userId, id, JSON.stringify(before), JSON.stringify({ ...after, passwordChanged: !!b.password })]);
    return after;
  }));

  // Branches and stores (admin) ---------------------------------------------------------------
  app.post("/api/branches", route(pool, "settings.manage", async ({ c, user, req }) => {
    const b = z.object({ name: z.string().trim().min(1).max(100), storeName: z.string().trim().min(1).max(100).optional() }).parse(req.body);
    try {
      const br = (await c.query("insert into branches (tenant_id, name) values ($1,$2) returning id, name", [user.tenantId, b.name])).rows[0];
      const st = (await c.query("insert into stores (tenant_id, branch_id, kind, name) values ($1,$2,'branch',$3) returning id, name", [user.tenantId, br.id, b.storeName ?? `${b.name} store`])).rows[0];
      await auditTx(c, user, "branch.create", "branch", br.id);
      return { ...br, store: st };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate", "A branch or store with this name already exists.");
      throw e;
    }
  }, 201));

  // Subscription (records only; there is no payment gateway) -------------------------------------
  app.get("/api/subscription", route(pool, "settings.manage", async ({ c }) => {
    const s = (await c.query(`select plan, billing_period "billingPeriod", to_char(next_invoice_date,'YYYY-MM-DD') "nextInvoiceDate" from subscriptions`)).rows[0]
      ?? { plan: "standard", billingPeriod: "monthly", nextInvoiceDate: null };
    const invoices = (await c.query(
      `select id, number, to_char(period_start,'YYYY-MM-DD') "periodStart", to_char(period_end,'YYYY-MM-DD') "periodEnd", amount_paise::float "amountPaise"
         from invoices order by period_start desc limit 100`)).rows;
    return { ...s, invoices };
  }));
  app.put("/api/subscription", route(pool, "settings.manage", async ({ c, user, req }) => {
    const b = z.object({ plan: z.string().trim().min(1).max(40), billingPeriod: z.enum(["monthly", "quarterly"]), nextInvoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).parse(req.body);
    await c.query(
      `insert into subscriptions (tenant_id, plan, billing_period, next_invoice_date) values ($1,$2,$3,$4)
       on conflict (tenant_id) do update set plan = excluded.plan, billing_period = excluded.billing_period, next_invoice_date = excluded.next_invoice_date`,
      [user.tenantId, b.plan, b.billingPeriod, b.nextInvoiceDate ?? null]);
    await auditTx(c, user, "subscription.update", "subscription", undefined, b);
    return b;
  }));

  // Licences shown in Settings > Licences. The model credit is required by its CC-BY-4.0 licence.
  app.get("/api/licences", route(pool, null, async () => ({
    models: [{ name: "Canary-180M-Flash", by: "NVIDIA", licence: "CC-BY-4.0", use: "Speech to text for English, German, French and Spanish", url: "https://huggingface.co/nvidia/canary-180m-flash" }],
    software: ["PostgreSQL (PostgreSQL licence)", "React, Express, Zod, node-postgres, ExcelJS, Argon2 (MIT)", "Tailwind CSS, Radix UI, shadcn/ui (MIT)", "Silero VAD (MIT)"],
  })));
}
