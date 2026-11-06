import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword, passwordProblem } from "../modules/auth/service";

export type NewClinic = {
  clinicName: string;
  branchName?: string;
  adminEmail: string;
  adminName: string;
  /** When omitted, a random one is generated and returned once. */
  password?: string;
};

export type CreatedClinic = { tenantId: string; branchId: string; adminUserId: string; adminEmail: string; password: string; generatedPassword: boolean };

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 16 characters without look-alikes (no 0/O, 1/l/I), with at least one letter and one digit. */
export function generatePassword(): string {
  for (;;) {
    const bytes = randomBytes(16);
    const pw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
    if (!passwordProblem(pw)) return pw;
  }
}

/**
 * Creates one real clinic with a head-office store, a first branch with its pharmacy, and an admin.
 * Runs as the owner role in a single transaction, so a failure leaves nothing behind. Everything else
 * (more branches, staff, the catalogue) is then done by the admin in the app.
 */
export async function createClinic(admin: pg.Pool, input: NewClinic): Promise<CreatedClinic> {
  const clinicName = input.clinicName.trim();
  const adminName = input.adminName.trim();
  const email = input.adminEmail.trim().toLowerCase();
  const branchName = (input.branchName ?? "Main branch").trim();
  if (!clinicName) throw new Error("Give the clinic a name.");
  if (!adminName) throw new Error("Give the admin a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The admin email does not look like an email address.");
  const generated = !input.password;
  const password = input.password ?? generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(`The password is too weak. ${problem}`);

  const taken = await admin.query("select 1 from users where lower(email) = $1", [email]);
  if (taken.rowCount) throw new Error(`The email ${email} already belongs to a user. Use a different admin email.`);

  const hash = await hashPassword(password);
  const c = await admin.connect();
  try {
    await c.query("begin");
    const tenantId = (await c.query("insert into tenants (name) values ($1) returning id", [clinicName])).rows[0].id as string;
    await c.query("insert into tenant_settings (tenant_id) values ($1)", [tenantId]);
    await c.query("insert into subscriptions (tenant_id) values ($1)", [tenantId]);
    const branchId = (await c.query("insert into branches (tenant_id, name) values ($1,$2) returning id", [tenantId, branchName])).rows[0].id as string;
    await c.query(
      "insert into stores (tenant_id, branch_id, kind, name) values ($1,null,'central','Central store'), ($1,$2,'branch',$3)",
      [tenantId, branchId, `${branchName} pharmacy`]);
    const adminUserId = (await c.query(
      "insert into users (tenant_id, email, name, password_hash, role) values ($1,$2,$3,$4,'admin') returning id",
      [tenantId, email, adminName, hash])).rows[0].id as string;
    await c.query("insert into audit_log (tenant_id, user_id, action, entity, entity_id, after) values ($1::uuid,$2::uuid,'tenant.create','tenant',$1::uuid::text,$3::jsonb)",
      [tenantId, adminUserId, JSON.stringify({ clinicName, branchName, adminEmail: email })]);
    await c.query("commit");
    return { tenantId, branchId, adminUserId, adminEmail: email, password, generatedPassword: generated };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
