/**
 * Times for the calling side, which are Singapore times.
 *
 * Singapore has been UTC+8 with no daylight saving since 1982, so the offset
 * is a constant rather than a lookup. If that ever changes, this is the one
 * place to change it.
 */
export const CALL_TZ = "Asia/Singapore";
const CALL_TZ_OFFSET = "+08:00";

/** Today in Singapore as YYYY-MM-DD, whatever zone the caller is in. */
export const callTzDate = (at: Date = new Date()) =>
  at.toLocaleDateString("en-CA", { timeZone: CALL_TZ });

/**
 * Read a callback time as the wall clock the caller typed.
 *
 * `<input type="datetime-local">` sends "2026-08-06T13:00" with no zone, and
 * `new Date()` reads that as the *server's* local time. On the droplet that is
 * UTC, so 1pm typed in Singapore was stored as 1pm UTC and read back as 9pm —
 * every callback landing eight hours late.
 *
 * The fix is to say which zone the wall clock belongs to rather than letting
 * two machines guess: what the caller types is Singapore time, which is also
 * how every screen displays it. A value that already carries a zone (an `Z` or
 * an offset) is an instant and is passed through untouched.
 */
export function parseCallbackAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = raw.trim();
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  const parsed = new Date(
    local
      ? `${local[1]}T${local[2]}${local[3] ?? ":00"}${CALL_TZ_OFFSET}`
      : value,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
