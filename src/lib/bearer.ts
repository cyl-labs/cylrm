import { timingSafeEqual } from "node:crypto";

/**
 * Does this Authorization header carry the shared `CRON_SECRET`?
 *
 * Compared in constant time (2026-09-29): a plain `!==` stops at the first
 * differing byte, which lets a patient caller work out a secret one character
 * at a time. Fails closed when the secret is unset, as the inline checks did.
 * Used by every cron route and by `/api/contracts/signed`.
 */
export function hasCronAuth(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
