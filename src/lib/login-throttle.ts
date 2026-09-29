/**
 * Slow down password guessing (2026-09-29).
 *
 * The login had no limit, so guesses were free and each one cost a scrypt hash
 * on a 1 vCPU droplet: a flood of attempts was a cheap way to slow the app for
 * the callers on it.
 *
 * Failures are counted per address and per username over a window, in memory.
 * There is one `crm` process, and a restart clearing the counts only ever
 * forgives, so nothing here needs the database. The check runs *before* the
 * hash, which is what protects the CPU.
 *
 * The username limit is higher and its wait shorter than the address one on
 * purpose: it is the one an attacker can use against somebody else, since
 * typing a caller's username wrong enough times would lock them out. Ten
 * misses in ten minutes is well past a caller mistyping a password on a phone.
 * A correct sign-in clears both counts.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_ADDRESS = 30;
const MAX_PER_USERNAME = 10;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const hits = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length) failures.set(key, hits);
  else failures.delete(key);
  return hits;
}

/** The address behind Caddy, which sets `X-Forwarded-For` itself. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** True when this address or username has missed too often lately. */
export function isThrottled(address: string, username: string): boolean {
  const now = Date.now();
  return (
    recent(`a:${address}`, now).length >= MAX_PER_ADDRESS ||
    recent(`u:${username.toLowerCase()}`, now).length >= MAX_PER_USERNAME
  );
}

export function recordFailure(address: string, username: string): void {
  const now = Date.now();
  for (const key of [`a:${address}`, `u:${username.toLowerCase()}`]) {
    failures.set(key, [...recent(key, now), now]);
  }
  // Keeps the map from growing with every address that ever missed once.
  if (failures.size > 5000) {
    for (const key of failures.keys()) recent(key, now);
  }
}

export function clearFailures(address: string, username: string): void {
  failures.delete(`a:${address}`);
  failures.delete(`u:${username.toLowerCase()}`);
}
