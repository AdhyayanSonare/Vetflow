import argon2 from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { withTenant } from "../db/pool";
import type { Role } from "./permissions";

export const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export const hashPassword = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Use 200 characters or fewer.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Include at least one letter and one number.";
  return null;
}

export type SessionUser = {
  tenantId: string; userId: string; role: Role; name: string; email: string; csrfToken: string;
};

// A fixed hash so a login for an unknown email takes as long as one for a real account.
const DUMMY = argon2.hash("not-a-real-password", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export type LoginResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; reason: "invalid" | "locked" };

export async function login(pool: pg.Pool, email: string, password: string): Promise<LoginResult> {
  const found = (await pool.query("select * from auth_lookup($1)", [email])).rows[0];
  if (!found) {
    await verifyPassword(await DUMMY, password);
    return { ok: false, reason: "invalid" };
  }
  if (found.locked_until && new Date(found.locked_until) > new Date()) return { ok: false, reason: "locked" };
  const good = found.active && (await verifyPassword(found.password_hash, password));
  if (!good) {
    await withTenant(found.tenant_id, async c => {
      const r = await c.query(
        `update users set failed_logins = failed_logins + 1,
           locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
         where id = $1 returning failed_logins`, [found.id, MAX_FAILED, LOCK_MINUTES]);
      if (r.rows[0]?.failed_logins >= MAX_FAILED) {
        await c.query("insert into audit_log (tenant_id, user_id, action, entity, entity_id) values ($1,$2::uuid,'auth.locked','user',$2::uuid::text)",
          [found.tenant_id, found.id]);
      }
    }, pool);
    return { ok: false, reason: "invalid" };
  }
  const token = newToken();
  const csrf = newToken();
  const user = await withTenant(found.tenant_id, async c => {
    await c.query("update users set failed_logins = 0, locked_until = null where id = $1", [found.id]);
    await c.query(
      "insert into sessions (id, tenant_id, user_id, csrf_token, expires_at) values ($1,$2,$3,$4, now() + make_interval(hours => $5))",
      [sha256(token), found.tenant_id, found.id, csrf, SESSION_HOURS]);
    await c.query("insert into audit_log (tenant_id, user_id, action, entity, entity_id) values ($1,$2::uuid,'auth.login','user',$2::uuid::text)",
      [found.tenant_id, found.id]);
    const u = (await c.query("select role, name, email from users where id = $1", [found.id])).rows[0];
    return { tenantId: found.tenant_id as string, userId: found.id as string, role: u.role as Role, name: u.name, email: u.email, csrfToken: csrf };
  }, pool);
  return { ok: true, token, user };
}

export async function authenticate(pool: pg.Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const r = (await pool.query("select * from session_lookup($1)", [sha256(token)])).rows[0];
  if (!r || !r.active) return null;
  return { tenantId: r.tenant_id, userId: r.user_id, role: r.role, name: r.name, email: r.email, csrfToken: r.csrf_token };
}

export async function logout(pool: pg.Pool, user: SessionUser, token: string) {
  await withTenant(user.tenantId, c => c.query("delete from sessions where id = $1", [sha256(token)]), pool);
}

export function csrfOk(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Creates a one-hour reset token. The caller delivers it (email or, for the demo, the admin). Returns null if no such user. */
export async function requestPasswordReset(pool: pg.Pool, email: string): Promise<string | null> {
  const found = (await pool.query("select * from auth_lookup($1)", [email])).rows[0];
  if (!found || !found.active) return null;
  const token = newToken();
  await withTenant(found.tenant_id, async c => {
    await c.query("insert into password_resets (token_hash, tenant_id, user_id, expires_at) values ($1,$2,$3, now() + interval '1 hour')",
      [sha256(token), found.tenant_id, found.id]);
    await c.query("insert into audit_log (tenant_id, user_id, action, entity, entity_id) values ($1,$2::uuid,'auth.reset_requested','user',$2::uuid::text)",
      [found.tenant_id, found.id]);
  }, pool);
  return token;
}

export async function completePasswordReset(pool: pg.Pool, token: string, newPassword: string): Promise<"ok" | "invalid" | "weak"> {
  if (passwordProblem(newPassword)) return "weak";
  const r = (await pool.query("select * from reset_lookup($1)", [sha256(token)])).rows[0];
  if (!r) return "invalid";
  const hash = await hashPassword(newPassword);
  return withTenant(r.tenant_id, async c => {
    const used = await c.query("update password_resets set used_at = now() where token_hash = $1 and used_at is null returning 1", [sha256(token)]);
    if (!used.rowCount) return "invalid" as const;
    await c.query("update users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1", [r.user_id, hash]);
    await c.query("delete from sessions where user_id = $1", [r.user_id]);
    await c.query("insert into audit_log (tenant_id, user_id, action, entity, entity_id) values ($1,$2::uuid,'auth.reset_done','user',$2::uuid::text)",
      [r.tenant_id, r.user_id]);
    return "ok" as const;
  }, pool);
}
