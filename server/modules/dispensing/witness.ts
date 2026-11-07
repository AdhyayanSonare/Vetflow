import type pg from "pg";
import { HttpError, auditTx } from "../../http/route";
import type { SessionUser } from "../auth/service";
import { verifyPassword } from "../auth/service";

export type Witness = { witnessUserId?: string; witnessPassword?: string };

/** Wrong witness passwords per acting user. Five misses in 15 minutes stop further tries, so this cannot be used to guess a colleague's password. */
const misses = new Map<string, { n: number; reset: number }>();
const MAX = 5;
const blocked = (userId: string) => {
  const h = misses.get(userId);
  return !!h && h.reset > Date.now() && h.n >= MAX;
};
function miss(userId: string) {
  const now = Date.now();
  const h = misses.get(userId);
  if (!h || h.reset <= now) misses.set(userId, { n: 1, reset: now + 15 * 60_000 });
  else h.n += 1;
}

/**
 * The two-person rule for controlled medicines: a different, active staff member confirms with their
 * own password. Throws unless it holds, and records the witness in the audit log on success.
 */
export async function requireWitness(c: pg.PoolClient, user: SessionUser, witness: Witness, entity: string, entityId: string) {
  if (!witness.witnessUserId || !witness.witnessPassword) {
    throw new HttpError(409, "witness_required", "A controlled medicine needs a second user to confirm.");
  }
  if (witness.witnessUserId === user.userId) throw new HttpError(409, "witness_same_user", "The second confirmation must come from a different user.");
  if (blocked(user.userId)) throw new HttpError(429, "witness_locked", "Too many wrong confirmations. Try again in a few minutes.");
  const w = (await c.query("select password_hash, role, active from users where id = $1", [witness.witnessUserId])).rows[0];
  if (!w || !w.active || !["admin", "inventory_manager", "pharmacist", "vet"].includes(w.role)
      || !(await verifyPassword(w.password_hash, witness.witnessPassword))) {
    miss(user.userId);
    throw new HttpError(403, "witness_invalid", "The second user's details are not correct.");
  }
  await auditTx(c, user, `${entity}.witness`, entity, entityId, { witnessUserId: witness.witnessUserId });
}
