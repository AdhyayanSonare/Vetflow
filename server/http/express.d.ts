import type { SessionUser } from "../modules/auth/service";

// Adds the signed-in user and session token to Express requests (set by attachSession).
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

export {};
