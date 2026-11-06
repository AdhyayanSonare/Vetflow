import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { can, type Permission } from "./auth/permissions";
import { rateLimit } from "./auth/rateLimit";
import {
  authenticate, completePasswordReset, csrfOk, login, logout, passwordProblem, requestPasswordReset,
  SESSION_HOURS, type SessionUser,
} from "./auth/service";
import { withTenant } from "./db/pool";
import { apiError } from "./http";
import { registerClinicalRoutes } from "./routes/clinical";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerStockOpsRoutes } from "./routes/stockops";

export const COOKIE = "vf_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: SessionUser; sessionToken?: string }
  }
}

export { apiError };

export function requirePermission(p: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return apiError(res, 401, "unauthenticated", "Sign in to continue.");
    if (!can(req.user.role, p)) return apiError(res, 403, "forbidden", "Your role does not allow this action.");
    next();
  };
}

/** Writes an audit entry in its own tenant transaction. */
export const audit = (pool: pg.Pool, u: SessionUser, action: string, entity: string, entityId?: string, after?: unknown, reason?: string) =>
  withTenant(u.tenantId, c => c.query(
    "insert into audit_log (tenant_id,user_id,action,entity,entity_id,after,reason) values ($1,$2,$3,$4,$5,$6,$7)",
    [u.tenantId, u.userId, action, entity, entityId ?? null, after ? JSON.stringify(after) : null, reason ?? null]), pool);

export function createApp(pool: pg.Pool, opts: { production?: boolean } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Security headers on every response.
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      ...(opts.production ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    next();
  });

  app.get("/api/health", async (_req, res) => {
    try { await pool.query("select 1"); res.json({ status: "ok" }); }
    catch { res.status(503).json({ status: "database_unavailable" }); }
  });

  // Attach the session user, and require a matching CSRF header on every write.
  app.use("/api", async (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE] as string | undefined;
      const user = await authenticate(pool, token);
      if (user) {
        req.user = user; req.sessionToken = token;
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !csrfOk(user.csrfToken, req.get("x-csrf-token"))) {
          return apiError(res, 403, "csrf", "Your session check failed. Refresh the page and try again.");
        }
      }
      next();
    } catch (e) { next(e); }
  });

  const loginLimit = rateLimit({
    windowMs: 15 * 60_000, max: 10, message: "Too many sign-in attempts. Try again in a few minutes.",
    key: req => `${req.ip}|${String(req.body?.email ?? "").toLowerCase()}`,
  });
  const resetLimit = rateLimit({ windowMs: 15 * 60_000, max: 5, message: "Too many requests. Try again later.", key: req => req.ip ?? "x" });

  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: !!opts.production, path: "/", maxAge: SESSION_HOURS * 3600_000 };

  app.post("/api/auth/login", loginLimit, async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
        return apiError(res, 400, "invalid", "Enter your email and password.");
      }
      const r = await login(pool, email.trim(), password);
      if (!r.ok) {
        return r.reason === "locked"
          ? apiError(res, 423, "locked", "This account is locked for 15 minutes after repeated failed sign-ins.")
          : apiError(res, 401, "invalid_credentials", "The email or password is not correct.");
      }
      res.cookie(COOKIE, r.token, cookieOpts);
      res.json({ user: { name: r.user.name, email: r.user.email, role: r.user.role }, csrfToken: r.user.csrfToken });
    } catch (e) { next(e); }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) return apiError(res, 401, "unauthenticated", "Sign in to continue.");
    const u = req.user;
    res.json({ user: { name: u.name, email: u.email, role: u.role }, csrfToken: u.csrfToken });
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      if (req.user && req.sessionToken) await logout(pool, req.user, req.sessionToken);
      res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Always answers the same way, so it cannot be used to find out which emails have accounts.
  app.post("/api/auth/reset/request", resetLimit, async (req, res, next) => {
    try {
      const email = req.body?.email;
      if (typeof email === "string" && email) {
        const token = await requestPasswordReset(pool, email.trim());
        // No mail server is wired up yet. In development the link is logged so the flow can be tested.
        if (token && !opts.production) console.log(`[dev] password reset token for ${email}: ${token}`);
        if (token) (app.locals.onResetToken as ((e: string, t: string) => void) | undefined)?.(email, token);
      }
      res.json({ ok: true, message: "If that email has an account, a reset link has been sent." });
    } catch (e) { next(e); }
  });

  app.post("/api/auth/reset/complete", resetLimit, async (req, res, next) => {
    try {
      const { token, password } = req.body ?? {};
      if (typeof token !== "string" || typeof password !== "string") return apiError(res, 400, "invalid", "Enter a new password.");
      const problem = passwordProblem(password);
      if (problem) return apiError(res, 400, "weak_password", problem);
      const r = await completePasswordReset(pool, token, password);
      if (r !== "ok") return apiError(res, 400, "invalid_token", "This reset link is not valid or has expired.");
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  registerInventoryRoutes(app, pool);
  registerClinicalRoutes(app, pool);
  registerStockOpsRoutes(app, pool);

  // Error handler: never leak internals.
  app.use("/api", (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err.message);
    apiError(res, 500, "server_error", "Something went wrong. Try again.");
  });
  return app;
}
