import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

/** `promisify` resolves to scrypt's shortest overload, which has no options
 *  argument — hence the explicit type, or the cost parameter is a type error. */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing, on node:crypto rather than a dependency.
 *
 * scrypt is in the standard library and is a memory-hard KDF, which is the
 * property that matters here: it makes guessing a stolen hash expensive.
 * bcrypt or argon2 would be equally fine and both are native builds — not
 * something to add to a 1 vCPU droplet's deploy for one table of staff logins.
 *
 * The parameters are stored alongside the hash, so raising them later leaves
 * existing passwords verifiable instead of locking everyone out.
 */
const N = 16384; // CPU/memory cost. ~50ms per hash on the droplet.
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, { N });
  return `scrypt$${N}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Check a password against a stored hash.
 *
 * Never throws: a malformed or empty hash is a failed login, not a 500. A
 * deactivated account whose hash was cleared would otherwise take the login
 * route down with it.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024) return false;

  try {
    const salt = Buffer.from(parts[2], "hex");
    const expected = Buffer.from(parts[3], "hex");
    const key = await scrypt(password, salt, expected.length, { N: cost });
    // Length is checked first because timingSafeEqual throws on a mismatch,
    // and a thrown comparison is a 500 where a false is wanted.
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** The rules the Team screen states and the API enforces. Short enough to be
 *  typed on a phone between calls, long enough not to be guessed. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Usernames are matched lowercase, so "Wei" and "wei" cannot become two
 * accounts whose calls are counted separately.
 */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,29}$/;
