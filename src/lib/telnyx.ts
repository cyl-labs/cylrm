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

/** Overridable only so a local sink can stand in for Telnyx while testing, in
 *  the same spirit as `TELEGRAM_API_BASE`. Never set in production. */
const API = process.env.TELNYX_API_BASE || "https://api.telnyx.com/v2";
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

  // Who to log in as.
  //
  // A generated telephony credential is what this app has always used, and it
  // places calls perfectly well — but nothing ever registers a gateway under
  // it, so an inbound call to the connection is answered SIP 480 and the
  // browser is never rung. A credential connection also carries one *static*
  // SIP user, and it is that user which `registration_status` reports on: it
  // has read "Not Registered" every time it has been looked at, on the working
  // connection as well as the broken one.
  //
  // So for somebody who has a connection to themselves — which is exactly the
  // set of people who need to be reachable on a number — log in as that
  // connection's own user. Everybody else keeps the generated credential,
  // since they only ever dial out.
  const cred = (await telnyx(`/telephony_credentials/${credentialId}`)) as {
    data: { sip_username: string; sip_password: string };
  };
  let login = cred.data.sip_username;
  let password = cred.data.sip_password;
  if (user.connectionId?.trim()) {
    const conn = (await telnyx(
      `/credential_connections/${user.connectionId.trim()}`,
    )) as { data: { user_name: string; password: string } };
    if (conn.data?.user_name && conn.data?.password) {
      login = conn.data.user_name;
      password = conn.data.password;
    }
  }

  // Only after a fresh credential. A token from one that already existed is
  // usable at once, and the dialler asks for this on mount, where five seconds
  // is a caller reading the first card rather than a caller waiting.
  if (minted) await new Promise((r) => setTimeout(r, PROPAGATION_MS));

  const out: CallLogin = { token, login, password };
  tokenCache.set(userId, {
    ...out,
    expiresAt: Math.min(Date.now() + CACHE_CAP_MS, credentialExpiresAt),
  });
  return out;
}

/**
 * Who logs in with their line's SIP user rather than a token.
 *
 * Everybody with a line of their own (`telnyx_connection_id`). A SIP login is
 * the only kind a call can ring, and a person is given a line precisely so that
 * their number rings them. Until 2026-09-15 this was an opt-in list in
 * `TELNYX_SIP_LOGIN_USERS`, which existed to move people over one at a time and
 * watch each; by then every caller was on it, and a list somebody has to
 * remember to add each new hire to is exactly how a new hire's phone would
 * never ring.
 *
 * The list's other job, rolling one person back, stays: anyone whose id is in
 * `TELNYX_TOKEN_ONLY_USERS` is put back on a token, which can dial out but
 * cannot be rung, with an `.env` edit and a restart.
 */
export async function usesSipLogin(userId: number): Promise<boolean> {
  const tokenOnly = (process.env.TELNYX_TOKEN_ONLY_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(userId));
  if (tokenOnly) return false;
  const [row] = await db
    .select({ connectionId: appUser.telnyxConnectionId })
    .from(appUser)
    .where(eq(appUser.id, userId));
  return Boolean(row?.connectionId?.trim());
}

/** A reason a line could not be set up, worded for the admin assigning it. */
export class LineSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineSetupError";
  }
}

/**
 * `telnyx()`, but safe for the ids this part of the API returns.
 *
 * Connection, number and voice profile ids are 19 digits — past what a JS
 * number holds exactly — so `res.json()` rounds them into a different line.
 * Quoting every long integer before parsing keeps them the strings they are
 * everywhere else, the same trick `lib/telnyx-usage.ts` uses on its reports.
 */
async function telnyxExact(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Telnyx ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return text
    ? (JSON.parse(text.replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ':"$1"')) as Record<
        string,
        unknown
      >)
    : {};
}

/**
 * The line settings copied from the shared connection onto a new one.
 *
 * Everything that makes a line behave like every other caller's — the webhook
 * that carries recordings and inbound calls back, the outbound voice profile
 * that decides recording and which countries can be rung, codecs, region — and
 * nothing that identifies it. Copied at the moment of creation rather than
 * written out here, so a setting changed on the shared line reaches new hires
 * without a deploy.
 */
const COPIED_LINE_SETTINGS = [
  "active",
  "anchorsite_override",
  "default_on_hold_comfort_noise_enabled",
  "dtmf_type",
  "encode_contact_header_enabled",
  "encrypted_media",
  "onnet_t38_passthrough_enabled",
  "third_party_control_enabled",
  "noise_suppression",
  "jitter_buffer",
  "webhook_event_url",
  "webhook_event_failover_url",
  "webhook_api_version",
  "webhook_timeout_secs",
  "call_cost_in_webhooks",
  "rtcp_settings",
  "inbound",
  "outbound",
  "sip_uri_calling_preference",
] as const;

/** Dropped rather than sent: an explicit null or empty string is not always
 *  accepted on create, and leaving the key out takes Telnyx's default, which
 *  is what the null on the template meant anyway. */
function withoutBlanks(value: unknown): unknown {
  if (value === null || value === "") return undefined;
  if (Array.isArray(value) || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, withoutBlanks(v)] as const)
      .filter(([, v]) => v !== undefined),
  );
}

/** The messaging profile texts arrive through, found by name so nothing new
 *  has to be configured. */
const TEXTING_PROFILE = "cylrm-sms";

/**
 * The carrier-approved 10DLC campaign a number must be linked to before it
 * can *send* texts — being on `TEXTING_PROFILE` above is only enough to
 * receive them. Unset means this step is skipped, the same rule every
 * optional integration follows: `text_access` still saves, the number just
 * stays receive-only until this is set.
 */
const TEXTING_CAMPAIGN_ID = process.env.TELNYX_10DLC_CAMPAIGN_ID;

/**
 * Put a caller's number onto the SMS campaign, the one step `provisionLine`
 * cannot do for them: a number can be on `cylrm-sms` and still have every
 * text refused by the carriers until it is linked here too. This was, until
 * now, a manual `PUT /10dlc/phone_number_campaigns/{number}` done once for
 * the Founders number — see docs/meetings.md.
 *
 * Not instant on Telnyx's side: each carrier maps it separately, and the
 * Founders number took about fifteen minutes to go from `PENDING_ASSIGNMENT`
 * to fully `ASSIGNED`. A caller granted texting can see a send fail for a
 * few minutes before it settles.
 */
export async function linkTextingCampaign(phoneNumber: string): Promise<void> {
  if (!TEXTING_CAMPAIGN_ID) return;
  await telnyx(`/10dlc/phone_number_campaigns/${encodeURIComponent(phoneNumber)}`, {
    method: "PUT",
    body: JSON.stringify({ phoneNumber, campaignId: TEXTING_CAMPAIGN_ID }),
  });
}

/**
 * The reverse: take a number off the campaign, back to the receive-only
 * state every caller starts in.
 *
 * A number already off the campaign (404) is the goal state, not a failure.
 * Telnyx also takes its own time clearing an unlink — a re-link attempted
 * seconds later is refused with "resource is being processed" (code 10036)
 * until it does — worth knowing if texting is switched off and back on for
 * the same person within a few minutes of each other.
 */
export async function unlinkTextingCampaign(phoneNumber: string): Promise<void> {
  if (!TEXTING_CAMPAIGN_ID) return;
  try {
    await telnyx(`/10dlc/phone_number_campaigns/${encodeURIComponent(phoneNumber)}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof Error && /\(404\)/.test(err.message)) return;
    throw err;
  }
}

/**
 * A new credential connection for one person, copied off the shared line.
 *
 * Named `cylrm-<username>` like every line made by hand before this. The SIP
 * user and password are generated: the browser is handed them by
 * `mintCallToken` and nobody ever types them. Exported on its own so it can be
 * exercised against Telnyx without pointing a real number anywhere.
 */
export async function createLineConnection(username: string): Promise<string> {
  const { connectionId: templateId } = config();
  const template = (await telnyxExact(`/credential_connections/${templateId}`))
    .data as Record<string, unknown>;
  const settings = Object.fromEntries(
    COPIED_LINE_SETTINGS.map((k) => [k, withoutBlanks(template[k])] as const).filter(
      ([, v]) => v !== undefined,
    ),
  );
  const random = () => crypto.randomUUID().replace(/-/g, "");
  const made = (await telnyxExact("/credential_connections", {
    method: "POST",
    body: JSON.stringify({
      ...settings,
      connection_name: `cylrm-${username}`,
      // Letters and digits only, like the hand-made ones, and unique on the
      // account whatever the username: two people called Alex must not share a
      // SIP user, or one browser registers as the other.
      user_name: `cylrm${username.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}${random().slice(0, 6)}`,
      password: random(),
    }),
  })).data as { id?: unknown };
  if (!made?.id) throw new LineSetupError("Telnyx did not return the new line.");
  return String(made.id);
}

/**
 * Make somebody reachable on the number they have just been assigned.
 *
 * The steps that were done by hand for every caller before 2026-09-15: a line
 * of their own copied off the shared one, the number pointed at it, the number
 * put on the texting profile, and the line saved against them. Missing any of
 * them failed quietly — a number on nobody's line rings nobody, and one off the
 * texting profile never shows a text — which is how a caller's number could go
 * unanswered for weeks with nothing on screen saying so.
 *
 * Idempotent: assigning a number to the person who already has it changes
 * nothing on Telnyx. The line is saved the moment it exists, so a failure
 * part-way can simply be retried and reuses it rather than making another.
 *
 * Pointing the number at this line takes its inbound calls away from anybody
 * else who holds the same number. That is what assigning it means, and the
 * Team screen asks before handing out a number somebody already has.
 */
export async function provisionLine(
  user: { id: number; username: string; telnyxConnectionId: string | null },
  did: string,
): Promise<{ connectionId: string; created: boolean }> {
  const found = (
    await telnyxExact(`/phone_numbers?filter[phone_number]=${encodeURIComponent(did)}`)
  ).data as Record<string, unknown>[] | undefined;
  const number = found?.find((n) => n.phone_number === did);
  if (!number) {
    throw new LineSetupError(`${did} is not a number on the Telnyx account.`);
  }

  let connectionId = user.telnyxConnectionId?.trim() || null;
  let created = false;
  if (!connectionId) {
    connectionId = await createLineConnection(user.username);
    created = true;
    // A credential belongs to one connection, so the old one has to go in the
    // same statement or their browser keeps registering where it was.
    await db
      .update(appUser)
      .set({
        telnyxConnectionId: connectionId,
        telnyxCredentialId: null,
        telnyxCredentialExpiresAt: null,
      })
      .where(eq(appUser.id, user.id));
  }

  if (String(number.connection_id ?? "") !== connectionId) {
    await telnyxExact(`/phone_numbers/${number.id}`, {
      method: "PATCH",
      body: JSON.stringify({ connection_id: connectionId }),
    });
  }

  // Best effort. A number that cannot take texts still rings, and failing the
  // whole assignment over it would leave somebody unreachable for a nicety.
  try {
    const profiles = (await telnyxExact("/messaging_profiles?page[size]=100"))
      .data as Record<string, unknown>[] | undefined;
    const profile = profiles?.find((p) => p.name === TEXTING_PROFILE);
    if (profile && String(number.messaging_profile_id ?? "") !== String(profile.id)) {
      await telnyxExact(`/phone_numbers/${number.id}/messaging`, {
        method: "PATCH",
        body: JSON.stringify({ messaging_profile_id: String(profile.id) }),
      });
    }
  } catch {
    // Left for the numbers panel; see above.
  }

  // Their cached login may be for a line they no longer have.
  tokenCache.delete(user.id);
  return { connectionId, created };
}

/**
 * Hand a line from somebody leaving to their replacement.
 *
 * The number already points at the line, so routing does not change — that is
 * the reason for reusing the line rather than building another. Two things do
 * change. The line is renamed after the new person, so the numbers panel on
 * Team names who has it. And its SIP password is replaced: the leaver's browser
 * was handed that password every day they worked, and a line that still
 * accepted it would be one they could go on registering against.
 */
export async function handOverLine(input: {
  connectionId: string;
  username: string;
  outgoingUserId: number;
  outgoingCredentialId: string | null;
}): Promise<void> {
  await telnyxExact(`/credential_connections/${input.connectionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      connection_name: `cylrm-${input.username}`,
      password: crypto.randomUUID().replace(/-/g, ""),
    }),
  });
  if (input.outgoingCredentialId) {
    // Best effort: an orphaned credential under a line whose password has
    // changed costs tidiness, not access.
    await telnyxExact(`/telephony_credentials/${input.outgoingCredentialId}`, {
      method: "DELETE",
    }).catch(() => {});
  }
  tokenCache.delete(input.outgoingUserId);
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

/**
 * Who a recorded call was between.
 *
 * The `call.recording.saved` webhook does not carry the numbers; the recording
 * resource does. Every recording saved between 2026-09-16 18:00 UTC and the
 * fix was stored without them because the webhook assumed otherwise.
 */
export async function recordingNumbers(
  recordingId: string,
): Promise<{ to: string | null; from: string | null }> {
  const body = (await telnyx(`/recordings/${recordingId}`)) as {
    data?: { to?: string | null; from?: string | null };
  };
  return { to: body.data?.to ?? null, from: body.data?.from ?? null };
}

/**
 * Whether Telnyx says a call was actually answered, from its billing record.
 *
 * The browser's own timer is not proof: until 2026-09-24 it carried the last
 * call's length into the next one when that one was never answered, and all
 * four "no recording" alerts that night were calls Telnyx had billed at zero
 * seconds (busy, unallocated, declined, cancelled). Null when Telnyx has no
 * record for the session, so the caller can decide what not knowing means.
 *
 * `inbound` because recording is on the outbound voice profile only: a call a
 * prospect placed to us was never recorded, so its absence is not a fault.
 * All three alerts on the night of 2026-09-24 were that.
 */
export async function callConnected(
  sessionId: string,
): Promise<{ connected: boolean; inbound: boolean } | null> {
  const q = new URLSearchParams({
    "filter[record_type]": "sip-trunking",
    "filter[telnyx_session_id]": sessionId,
  });
  const body = (await telnyx(`/detail_records?${q}`)) as {
    data?: { connected?: boolean; call_sec?: number; direction?: string }[];
  };
  const rows = body.data ?? [];
  if (rows.length === 0) return null;
  return {
    connected: rows.some((r) => r.connected === true || (r.call_sec ?? 0) > 0),
    inbound: rows.every((r) => r.direction === "inbound"),
  };
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

export type SmsSendResult =
  | { ok: true; id: string; status: "queued" | "sent" }
  | {
      ok: false;
      /** Telnyx's own error code, or `unconfigured` / `unreachable` for the
       *  two failures where Telnyx never gave an answer. */
      code?: string;
      detail?: string;
    };

/**
 * Send one text. See `lib/sms.ts` for what it is for and why it is switched
 * off.
 *
 * Returns rather than throws, because the caller has to tell three outcomes
 * apart and say each differently. Telnyx refused it: there is a code, and
 * nothing was sent. Telnyx never answered: the text may or may not have gone,
 * and pressing send again could text the prospect twice. Or texting is simply
 * not configured.
 */
export async function sendSms(
  from: string,
  to: string,
  text: string,
): Promise<SmsSendResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return { ok: false, code: "unconfigured" };

  let res: Response;
  try {
    res = await fetch(`${API}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // No messaging profile id: the `from` number belongs to one, and that is
      // what Telnyx sends it under.
      body: JSON.stringify({ from, to, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      code: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; to?: { status?: string }[] };
    errors?: { code?: string | number; title?: string; detail?: string }[];
  };
  if (!res.ok) {
    const e = body.errors?.[0];
    return {
      ok: false,
      code: e?.code !== undefined ? String(e.code) : undefined,
      detail: e?.detail ?? e?.title ?? `HTTP ${res.status}`,
    };
  }
  // Accepted with nothing to track it by: treated like no answer, since the
  // text may well be on its way.
  if (!body.data?.id) {
    return { ok: false, code: "unreachable", detail: "No message id returned." };
  }
  return {
    ok: true,
    id: body.data.id,
    status: body.data.to?.[0]?.status === "sent" ? "sent" : "queued",
  };
}

/**
 * Start recording a live call, dual channel like the outbound profile's, so a
 * transcript can still tell the two sides apart (2026-09-25).
 *
 * For calls the prospect places to us, which the outbound voice profile never
 * records: the webhook calls this when one is answered. The result arrives
 * through the same `call.recording.saved` webhook as every other recording,
 * keyed on the same session, so the call row logged on it finds it the usual
 * way. A refusal changes nothing about the call itself.
 */
export async function startRecording(callControlId: string): Promise<void> {
  await telnyx(`/calls/${encodeURIComponent(callControlId)}/actions/record_start`, {
    method: "POST",
    body: JSON.stringify({ format: "mp3", channels: "dual" }),
  });
}
