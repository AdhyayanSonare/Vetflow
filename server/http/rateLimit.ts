import type { NextFunction, Request, Response } from "express";

/** Fixed-window limiter keyed by caller. Memory only, which is fine for one API process. */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; message: string }) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const k = opts.key(req);
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + opts.windowMs }; hits.set(k, h); }
    h.n += 1;
    if (hits.size > 10_000) for (const [key, v] of hits) if (v.reset < now) hits.delete(key);
    if (h.n > opts.max) {
      res.set("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: { code: "rate_limited", message: opts.message } });
    }
    next();
  };
}
