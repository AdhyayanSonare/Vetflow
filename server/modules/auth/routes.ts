import type { Express } from "express";
import type pg from "pg";
import { DEMO_USERS } from "../../../shared/demo";
import { apiError } from "../../http/errors";
import { SESSION_COOKIE } from "../../http/middleware";
import { rateLimit } from "../../http/rateLimit";
import {
  completePasswordReset, login, logout, passwordProblem, requestPasswordReset, SESSION_HOURS,
} from "./service";

export type AuthRouteOptions = {
  production?: boolean;
  demoMode?: boolean;
  /**
   * Returns the function that delivers a reset token (by mail, once a mail server is wired in), or
   * nothing when this system cannot deliver one. With no delivery, no token is created and people are
   * told to ask their clinic admin, who can set a new password under Settings > Users.
   */
  resetDelivery?: () => ((email: string, token: string) => void) | undefined;
};

export const RESET_BY_ADMIN_MESSAGE =
  "Password reset by email is not set up on this system. Ask your clinic admin to set a new password for you under Settings, Users.";

export function registerAuthRoutes(app: Express, pool: pg.Pool, opts: AuthRouteOptions = {}) {
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000, max: 10, message: "Too many sign-in attempts. Try again in a few minutes.",
    key: req => `${req.ip}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
  });
  const resetLimit = rateLimit({ windowMs: 15 * 60_000, max: 5, message: "Too many requests. Try again later.", key: req => req.ip ?? "x" });
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: !!opts.production, path: "/", maxAge: SESSION_HOURS * 3600_000 };

  // Lets the sign-in page offer one-click demo accounts. Off unless DEMO_MODE is set, and then it only names the invented demo users.
  app.get("/api/auth/demo", (_req, res) => {
    res.json(opts.demoMode ? { enabled: true, accounts: DEMO_USERS.map(u => ({ email: u.email, name: u.name, title: u.title })) } : { enabled: false, accounts: [] });
  });

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
      res.cookie(SESSION_COOKIE, r.token, cookie);
      res.json({ user: { name: r.user.name, email: r.user.email, role: r.user.role }, csrfToken: r.user.csrfToken });
    } catch (e) { next(e); }
  });

  app.get("/api/auth/me", (req, res) => {
    const u = req.user;
    if (!u) return apiError(res, 401, "unauthenticated", "Sign in to continue.");
    res.json({ user: { name: u.name, email: u.email, role: u.role }, csrfToken: u.csrfToken });
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      if (req.user && req.sessionToken) await logout(pool, req.user, req.sessionToken);
      res.clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Always answers the same way, so it cannot be used to find out which emails have accounts.
  app.post("/api/auth/reset/request", resetLimit, async (req, res, next) => {
    try {
      const deliver = opts.resetDelivery?.();
      // Same answer for every email, so this cannot be used to find out who has an account.
      if (!deliver) return void res.json({ ok: true, delivery: "admin", message: RESET_BY_ADMIN_MESSAGE });
      const email = req.body?.email;
      if (typeof email === "string" && email) {
        const token = await requestPasswordReset(pool, email.trim());
        if (token) deliver(email, token);
      }
      res.json({ ok: true, delivery: "email", message: "If that email has an account, a reset link has been sent." });
    } catch (e) { next(e); }
  });

  app.post("/api/auth/reset/complete", resetLimit, async (req, res, next) => {
    try {
      const { token, password } = req.body ?? {};
      if (typeof token !== "string" || typeof password !== "string") return apiError(res, 400, "invalid", "Enter a new password.");
      const problem = passwordProblem(password);
      if (problem) return apiError(res, 400, "weak_password", problem);
      if ((await completePasswordReset(pool, token, password)) !== "ok") {
        return apiError(res, 400, "invalid_token", "This reset link is not valid or has expired.");
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
