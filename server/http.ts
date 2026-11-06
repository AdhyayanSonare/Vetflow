import type { Response } from "express";

export const apiError = (res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  res.status(status).json({ error: { code, message, ...extra } });
