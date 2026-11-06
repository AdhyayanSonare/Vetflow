import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Optional shared-password gate (HTTP Basic auth, any username). Enabled when SITE_PASSWORD is set,
 * so the site and the Groq-backed endpoints are not open to anyone who finds the URL.
 * `/api/health` stays open for the host's health check.
 */
export function sitePassword(getPassword: () => string = () => process.env.SITE_PASSWORD ?? "") {
  return (req: Request, res: Response, next: NextFunction) => {
    const password = getPassword();
    if (!password || req.path === "/api/health") return next();

    const header = req.headers.authorization ?? "";
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const supplied = decoded.slice(decoded.indexOf(":") + 1);
      if (decoded.includes(":") && safeEqual(supplied, password)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="VetFlow", charset="UTF-8"').status(401).send("Password required");
  };
}
