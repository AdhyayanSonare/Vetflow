import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import type { Logger } from "../logging/logger";
import { authenticate, csrfOk } from "../modules/auth/service";
import { apiError } from "./errors";

export const SESSION_COOKIE = "vf_session";

/** Security headers on every response. The CSP is relaxed only for the Vite dev server. */
export function securityHeaders(opts: { production?: boolean; relaxCsp?: boolean }) {
  const csp =
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
    "script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      ...(opts.relaxCsp ? {} : { "Content-Security-Policy": csp }),
      ...(opts.production ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    next();
  };
}

/** Gives every request an id and logs one line when it finishes. Query strings and bodies are never logged. */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.get("x-request-id")?.slice(0, 64) || randomUUID();
    const started = process.hrtime.bigint();
    res.set("X-Request-Id", id);
    res.on("finish", () => {
      if (req.path === "/api/health") return;
      logger.info({
        id, method: req.method, path: req.path, status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10, user: req.user?.userId, tenant: req.user?.tenantId,
      }, "request");
    });
    next();
  };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Optional shared password in front of the whole site, as HTTP Basic auth with any username.
 * Switched on by SITE_PASSWORD, so a public demo is not open to anyone who finds the URL.
 * /api/health stays open for host health checks.
 */
export function sitePassword(getPassword: () => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const password = getPassword();
    if (!password || req.path === "/api/health") return next();
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      if (decoded.includes(":") && safeEqual(decoded.slice(decoded.indexOf(":") + 1), password)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Vetflow", charset="UTF-8"').status(401).send("Password required");
  };
}

/** Attaches the signed-in user, and requires a matching CSRF header on every write from a signed-in session. */
export function attachSession(pool: pg.Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
      const user = await authenticate(pool, token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !csrfOk(user.csrfToken, req.get("x-csrf-token"))) {
          return apiError(res, 403, "csrf", "Your session check failed. Refresh the page and try again.");
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Last stop for errors: log the detail, return a generic message. */
export function apiErrorHandler(logger: Logger) {
  return (err: Error & { type?: string; status?: number }, req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large") return apiError(res, 413, "too_large", "That upload is too large.");
    if (err.type === "entity.parse.failed") return apiError(res, 400, "invalid_json", "The request body is not valid JSON.");
    logger.error({ err: { message: err.message, name: err.name }, path: req.path, method: req.method }, "unhandled api error");
    apiError(res, 500, "server_error", "Something went wrong. Try again.");
  };
}
