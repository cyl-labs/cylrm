import { createPublicKey, verify as verifySignature } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";

/**
 * Telnyx, server side only.
 *
 * The one module that reads `TELNYX_API_KEY`. The browser never sees it: it
 * gets a short-lived JWT minted here, which is the whole reason on-demand
 * credentials exist.
 *
 * Shaped after `lib/google.ts` — a lazy throwing config accessor so a missing
 * variable fails one request rather than the process boot, a token cache
 * refreshed early, and a typed error the routes can branch on.
 */

export class TelnyxNotConfiguredError extends Error {
  constructor() {
    super(
      "Calling is not configured: TELNYX_API_KEY and TELNYX_CONNECTION_ID must be set.",
    );
    this.name = "TelnyxNotConfiguredError";
  }
}

function config() {
  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_CONNECTION_ID;
  if (!apiKey || !connectionId) throw new TelnyxNotConfiguredError();
  return { apiKey, connectionId };
}

const API = "https://api.telnyx.com/v2";
const TIMEOUT_MS = 15_000;

async function telnyx(path: string, init: RequestInit = {}) {
  const { apiKey } = config();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `Telnyx ${init.method ?? "GET"} ${path} failed (${res.status}): ${JSON.stringify(
        body,
      ).slice(0, 300)}`,
    );
  }
  return body;
}

/**
 * A browser token for this caller.
 *
 * Cached in memory, but expiring at `min(12h, credentialExpiresAt)`. The JWT
 * dies with its parent credential, so a flat cache would keep handing out a
 * token minted late in that credential's life which expires an hour later, and
 * the dial button would stop mid-shift with nothing to point at.
 *
 * The credential id lives on `app_user`, not in this map. Telnyx does not
 * enforce unique credential names, so forgetting it across a deploy mints
 * another one every time with no handle left to delete the old.
 */
const tokenCache = new Map<number, CallLogin & { expiresAt: number }>();

/**
 * What a browser needs to reach Telnyx.
 *
 * Two ways in, and they are not equivalent. A `token` authenticates a session
 * that can *place* calls; `login`/`password` performs a Verto login that
 * registers a gateway, and only a registered gateway can be *rung*. An inbound
 * call to a token-only session is answered SIP 480 — the registrar saying
 * nobody is there — which is precisely what receiving a call looked like until
 * this was understood.
 */
export type CallLogin = { token: string; login: string; password: string };

const CACHE_CAP_MS = 12 * 60 * 60 * 1000;
const CREDENTIAL_LIFE_MS = 24 * 60 * 60 * 1000;
/** Telnyx documents a short delay before a fresh credential authenticates. */
const PROPAGATION_MS = 5_000;

export async function mintCallToken(userId: number): Promise<CallLogin> {
  config();

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, login: cached.login, password: cached.password };
  }

  const [user] = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      connectionId: appUser.telnyxConnectionId,
      credentialId: appUser.telnyxCredentialId,
      expiresAt: appUser.telnyxCredentialExpiresAt,
    })
    .from(appUser)
    .where(eq(appUser.id, userId));
  if (!user) throw new Error("No such user.");

  // Their own connection, or the shared one. Somebody who has to be reachable
  // on a number gets a connection to themselves, because that is the thing an
  // inbound call can be routed to — see the column's note in `schema.ts`.
  const connectionId = user.connectionId?.trim() || config().connectionId;

  // Reuse while there is comfortable life left; a credential about to expire
  // would mint a token that dies with it.
  const remaining = user.expiresAt
    ? user.expiresAt.getTime() - Date.now()
    : 0;
  let credentialId = user.credentialId;
  let credentialExpiresAt = user.expiresAt?.getTime() ?? 0;
  let minted = false;

  // A credential lives under one connection. Moving somebody between
  // connections therefore has to clear `telnyx_credential_id` in the same
  // statement, or they keep registering against the room they just left and
  // their number rings nobody. Not enforced here — nothing in the request
  // knows the credential's connection without asking Telnyx — so it is done
  // where the move is made, and said out loud in the migration.
  if (!credentialId || remaining < 2 * 60 * 60 * 1000) {
    if (credentialId) {
      // Best effort: an orphan costs nothing but tidiness, and failing to
      // delete the old one must not stop the caller getting a new token.
      await telnyx(`/telephony_credentials/${credentialId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    const expiresAt = new Date(Date.now() + CREDENTIAL_LIFE_MS);
    const created = (await telnyx("/telephony_credentials", {
      method: "POST",
      body: JSON.stringify({
        connection_id: connectionId,
        name: `cylrm:${user.username}`,
        expires_at: expiresAt.toISOString(),
      }),
    })) as { data: { id: string } };
    credentialId = created.data.id;
    credentialExpiresAt = expiresAt.getTime();
    minted = true;

    await db
      .update(appUser)
      .set({
        telnyxCredentialId: credentialId,
        telnyxCredentialExpiresAt: expiresAt,
      })
      .where(eq(appUser.id, userId));
  }

  const res = await fetch(`${API}/telephony_credentials/${credentialId}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config().apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Telnyx token mint failed (${res.status}).`);
  const token = (await res.text()).trim();

  // The SIP user behind that credential. Fetched rather than kept from the
  // create call, because a reused credential never went through it.
  const cred = (await telnyx(`/telephony_credentials/${credentialId}`)) as {
    data: { sip_username: string; sip_password: string };
  };

  // Only after a fresh credential. A token from one that already existed is
  // usable at once, and the dialler asks for this on mount, where five seconds
  // is a caller reading the first card rather than a caller waiting.
  if (minted) await new Promise((r) => setTimeout(r, PROPAGATION_MS));

  const out: CallLogin = {
    token,
    login: cred.data.sip_username,
    password: cred.data.sip_password,
  };
  tokenCache.set(userId, {
    ...out,
    expiresAt: Math.min(Date.now() + CACHE_CAP_MS, credentialExpiresAt),
  });
  return out;
}

/**
 * Who logs in with SIP credentials rather than a token.
 *
 * A comma-separated list of user ids in `TELNYX_SIP_LOGIN_USERS`, because this
 * changes how a caller authenticates and getting it wrong takes the phone away
 * from the whole floor. An env list rolls back in the time it takes to edit
 * `.env` and restart, needs no migration, and lets one person be moved over and
 * watched before anybody else is.
 *
 * Empty means everybody keeps the token, which is exactly today's behaviour.
 */
export function usesSipLogin(userId: number): boolean {
  return (process.env.TELNYX_SIP_LOGIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(userId));
}

/**
 * Is a webhook really from Telnyx?
 *
 * Ed25519 over `${timestamp}|${rawBody}`, against the account public key. The
 * raw body matters: parsing and re-serialising changes bytes and the signature
 * stops matching.
 *
 * Deliberately no timestamp-age check. Telnyx retries carry the *original*
 * timestamp, and their retry schedule is not published, so a short tolerance
 * would reject the retry after any transient failure and lose that recording
 * for good. Replay is handled by the unique `recording_id` instead: a repeated
 * valid payload upserts the same row and changes nothing.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  try {
    // Telnyx publishes a raw 32-byte key; node wants DER SPKI, which for
    // Ed25519 is that fixed prefix followed by the key.
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKey, "base64"),
    ]);
    return verifySignature(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      createPublicKey({ key: der, format: "der", type: "spki" }),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** A fresh download URL for a recording. The ones in the webhook are presigned
 *  and expire in ten minutes, so they are never stored. */
export async function recordingDownloadUrl(
  recordingId: string,
): Promise<string | null> {
  const body = (await telnyx(`/recordings/${recordingId}`)) as {
    data?: { download_urls?: { mp3?: string; wav?: string } };
  };
  return body.data?.download_urls?.mp3 ?? body.data?.download_urls?.wav ?? null;
}

export type AccountNumber = {
  phoneNumber: string;
  country: string | null;
  /** What inbound calls to it already reach, so a client's line is visible. */
  inbound: string | null;
  available: boolean;
  /** Our own note on what the number is for. Not from Telnyx — see
   *  `call_number.label`. */
  label: string | null;
};

/**
 * The numbers on the account, with the ones taken out of the pool marked.
 *
 * Best effort on the Telnyx half: if it is unreachable the screen still works,
 * it just cannot offer a list to pick from.
 */
export async function listAccountNumbers(
  reserved: Set<string>,
  labels: Map<string, string> = new Map(),
): Promise<AccountNumber[]> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`${API}/phone_numbers?page%5Bsize%5D=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: {
        phone_number: string;
        country_iso_alpha2?: string;
        connection_name?: string | null;
      }[];
    };
    return (body.data ?? []).map((n) => ({
      phoneNumber: n.phone_number,
      country: n.country_iso_alpha2 ?? null,
      inbound: n.connection_name ?? null,
      available: !reserved.has(n.phone_number),
      label: labels.get(n.phone_number) ?? null,
    }));
  } catch {
    return [];
  }
}
