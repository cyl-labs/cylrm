import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, self-contained unsubscribe tokens.
 *
 * A recipient has no login, so the link in an email has to carry its own
 * authority. The token is `<contactId>.<hmac>` — a plain id would let anyone
 * unsubscribe anyone by counting upwards, and a random stored token would
 * mean a table and a lookup for something a signature already proves.
 *
 * Signed with TOKEN_ENCRYPTION_KEY under a distinct label so these can never
 * be confused with, or produced from, the secrets used to encrypt credentials.
 */
const LABEL = "unsubscribe-link-v1";

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)",
    );
  }
  return createHmac("sha256", Buffer.from(hex, "hex")).update(LABEL).digest();
}

function sign(contactId: number): string {
  return createHmac("sha256", key())
    .update(String(contactId))
    .digest("base64url")
    .slice(0, 27);
}

export function unsubscribeToken(contactId: number): string {
  return `${contactId}.${sign(contactId)}`;
}

/** Returns the contact id, or null if the token is malformed or forged. */
export function verifyUnsubscribeToken(token: string): number | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const contactId = Number(token.slice(0, dot));
  if (!Number.isInteger(contactId) || contactId <= 0) return null;

  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(contactId));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? contactId : null;
}

/**
 * Absolute base for links that have to work from inside an email client.
 *
 * Deliberately NOT `APP_URL`: that is the worker's internal base and is set
 * to http://localhost:3005 in production so cron calls don't depend on DNS or
 * TLS. Using it here would put a localhost link in every email.
 */
export function appBaseUrl(): string {
  const base = process.env.PUBLIC_APP_URL;
  if (!base) {
    throw new Error(
      "PUBLIC_APP_URL must be set to the externally reachable origin " +
        "(e.g. https://crm.cyllabs.com) — unsubscribe links go out in email.",
    );
  }
  return base.replace(/\/$/, "");
}

export function unsubscribeUrl(contactId: number): string {
  return `${appBaseUrl()}/u/${unsubscribeToken(contactId)}`;
}

/** The URL Gmail POSTs to for one-click; also redirects humans to the page. */
export function unsubscribePostUrl(contactId: number): string {
  return `${appBaseUrl()}/api/u/${unsubscribeToken(contactId)}`;
}
