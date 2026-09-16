import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { SmsMedia } from "@/db/schema";
import { phoneKeyCandidates } from "@/lib/calls";
import { pushToUser } from "@/lib/push";
import { conversationHref } from "@/lib/text-key";

/**
 * Texting: sending a prospect a text, and everything that arrives on our
 * numbers.
 *
 * Sending is narrow. Only an admin sends, from their own number, with the words
 * in front of them — never a campaign, never automatic. It started as one use,
 * a founder texting a prospect at demo time after a call nobody picked up, and
 * the Texts screen (`lib/texts.ts`) extended it to replying in a conversation.
 *
 * Receiving is wide. Every caller's number takes texts (2026-09-15), because
 * somebody who misses a call from us often texts the number back instead of
 * ringing it, and before then those texts reached nobody.
 *
 * **Switched on 2026-09-15**, once the carriers provisioned the 10DLC campaign
 * (TCR C3DSJFI). Without `TELNYX_SMS_ENABLED=1` nothing here reads or writes
 * `call_sms`, no screen shows anything, and the webhook answers message events
 * 200 and ignores them.
 *
 * The message goes out exactly as typed: no brand prefix, no opt-out footer,
 * no "you agreed to receive texts" confirmation. That was the founders' call,
 * made knowingly — the footer and the confirmation read as a machine, and this
 * is supposed to read as the person who just rang. Carriers do expect opt-out
 * wording on business texts in general; the risk accepted is a complaint
 * getting the campaign suspended. Telnyx still honours STOP on its own and
 * refuses any later send to that number, so the safety net exists without the
 * words.
 */

export const smsEnabled = () => process.env.TELNYX_SMS_ENABLED === "1";

export type SmsStatus = "queued" | "sent" | "delivered" | "failed" | "received";

export type SmsMessage = {
  id: number;
  direction: "out" | "in";
  body: string;
  status: SmsStatus;
  /** Why an outbound text did not arrive, already in words. */
  error: string | null;
  /** Who sent it. Outbound only — an inbound text is from the prospect. */
  byName: string | null;
  at: string;
  /**
   * Pictures and files on the text, type and size only.
   *
   * **No url, deliberately** — the stored one is a public Telnyx S3 object, so
   * the bytes come from `/api/texts/media/[id]`, which checks who is asking.
   * Mirrors `TextMessage.media` on the Texts screen because both are drawn by
   * `TextMedia`; if one gains a field the other wants it too.
   */
  media: { contentType: string; size: number | null }[];
};

export type LeadTexts = {
  texts: SmsMessage[];
  /**
   * Their latest keyword was STOP or a synonym, so Telnyx will refuse anything
   * further. Said on the screen so the button does not simply look broken.
   */
  optedOut: boolean;
};

/** What the meetings screen is handed when texting is on, and null when it is
 *  not — which is the whole of how the feature stays invisible. */
export type Texting = {
  byLead: Record<number, LeadTexts>;
  /** The signed-in admin's own US number, or null when they have none. */
  from: string | null;
};

type Row = Record<string, unknown>;

/** A parameterised `in (…)` list — the same shape `findCandidates` in
 *  `lib/meetings.ts` uses, so no value reaches the statement as text. */
const inList = <T>(values: T[]) =>
  sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/**
 * Telnyx's default opt-out and opt-in keywords.
 *
 * Only a text that *is* the keyword counts. "Can you stop by at 3" is a reply,
 * and treating it as an opt-out would hide a live conversation behind a notice
 * saying the prospect asked to be left alone.
 */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop"]);
const keyword = (body: string) => body.trim().toLowerCase().replace(/[.!]+$/, "");

/**
 * Whether their texts, oldest first, leave them opted out.
 *
 * The latest keyword wins, so STOP then START is texting again, exactly as
 * Telnyx reads it. One function for the Meetings thread and the Texts screen,
 * so the two cannot disagree about whether a send button should be there.
 */
export function optedOutOf(inboundBodies: string[]): boolean {
  let out = false;
  for (const body of inboundBodies) {
    const k = keyword(body);
    if (STOP_WORDS.has(k)) out = true;
    else if (START_WORDS.has(k)) out = false;
  }
  return out;
}

/**
 * Every text to or from these leads, oldest first.
 *
 * Keyed by lead rather than by meeting, because a conversation is with a
 * person: a prospect who missed a demo and rebooked is one thread across two
 * meetings, and splitting it would hide the "sorry, can we do Thursday" that
 * explains the second booking.
 */
export async function getTextsByLead(
  leadIds: number[],
): Promise<Record<number, LeadTexts>> {
  const ids = [...new Set(leadIds)];
  if (!smsEnabled() || ids.length === 0) return {};

  const rows = (await db.execute(sql`
    select s.id, s.call_lead_id, s.direction, s.body, s.status, s.error,
      s.created_at, s.media, u.name as by_name
    from call_sms s
    left join app_user u on u.id = s.user_id and s.direction = 'out'
    where s.call_lead_id in ${inList(ids)}
    order by s.created_at asc, s.id asc
  `)) as Row[];

  const out: Record<number, LeadTexts> = {};
  for (const r of rows) {
    const lead = (out[Number(r.call_lead_id)] ??= { texts: [], optedOut: false });
    lead.texts.push({
      id: Number(r.id),
      direction: r.direction === "in" ? "in" : "out",
      body: String(r.body ?? ""),
      status: r.status as SmsStatus,
      error: (r.error as string | null) ?? null,
      byName: (r.by_name as string | null) ?? null,
      at: new Date(r.created_at as string).toISOString(),
      // Type and size only; the url stays on the server. See `SmsMessage`.
      media: (Array.isArray(r.media) ? (r.media as SmsMedia[]) : []).map(
        (m) => ({
          contentType: m.contentType || "application/octet-stream",
          size: typeof m.size === "number" ? m.size : null,
        }),
      ),
    });
  }
  for (const lead of Object.values(out)) {
    lead.optedOut = optedOutOf(
      lead.texts.filter((t) => t.direction === "in").map((t) => t.body),
    );
  }
  return out;
}

export async function isOptedOut(leadId: number): Promise<boolean> {
  return (await getTextsByLead([leadId]))[leadId]?.optedOut ?? false;
}

/**
 * Why a text did not go, in words a founder can act on.
 *
 * Telnyx's own titles are written for developers ("Invalid 'from' address"),
 * and the ones likely to happen here each have a different fix. The landline
 * line is the one worth knowing about in advance: the lists are scraped
 * business numbers, and plenty of those are desk phones that cannot receive a
 * text at all.
 */
export function explainTextError(code?: string, detail?: string): string {
  switch (code) {
    case "40010":
      return "Texting isn't approved for your number yet. The carriers have to approve the campaign, and the number has to be attached to it on Telnyx.";
    case "40305":
      return "Your number isn't set up for texting. It needs adding to the cylrm-sms messaging profile on Telnyx.";
    case "40300":
      return "They replied STOP, so Telnyx won't send them any more texts.";
    case "40310":
      return "That number can't receive texts.";
    case "40008":
      return "Their carrier didn't accept it. Business numbers are often landlines, which can't receive texts.";
    case "40015":
    case "40322":
      return "It was blocked as spam. Try different wording.";
    case "unconfigured":
      return "Texting isn't configured: TELNYX_API_KEY is missing.";
    default:
      return detail
        ? `It didn't go through: ${detail}`
        : "It didn't reach their phone. Business numbers are often landlines, which can't receive texts.";
  }
}

export async function recordOutbound(input: {
  telnyxId: string;
  from: string;
  to: string;
  body: string;
  status: SmsStatus;
  /** Null for a text sent from the Texts screen to somebody with no booking,
   *  or with no lead at all. */
  meetingId: number | null;
  leadId: number | null;
  userId: number;
}): Promise<void> {
  await db.execute(sql`
    insert into call_sms (
      telnyx_message_id, direction, from_number, to_number, body, status,
      meeting_id, call_lead_id, user_id
    ) values (
      ${input.telnyxId}, 'out', ${input.from}, ${input.to}, ${input.body},
      ${input.status}, ${input.meetingId}, ${input.leadId}, ${input.userId}
    )
    on conflict (telnyx_message_id) do nothing
  `);
}

const RANK: Record<SmsStatus, number> = {
  queued: 0,
  received: 0,
  sent: 1,
  delivered: 2,
  failed: 2,
};

/**
 * Move an outbound text along as Telnyx reports on it.
 *
 * Only ever forwards. Webhooks are retried and can arrive out of order, and a
 * late `message.sent` must not turn a delivered text back into merely sent.
 * `delivery_unconfirmed` reads as sent rather than failed: the carrier said
 * nothing, which is not the same as saying no.
 *
 * A `message.sent` that beats the row's insert is lost, which costs nothing —
 * `message.finalized` follows seconds later and carries the answer that
 * matters.
 */
export async function updateTextStatus(p: Record<string, unknown>): Promise<boolean> {
  const id = String(p.id ?? "");
  const to = Array.isArray(p.to)
    ? (p.to[0] as { status?: string } | undefined)
    : undefined;
  const raw = String(to?.status ?? "");
  const status: SmsStatus | null =
    raw === "delivered"
      ? "delivered"
      : raw === "sending_failed" || raw === "delivery_failed"
        ? "failed"
        : raw === "sent" || raw === "delivery_unconfirmed"
          ? "sent"
          : null;
  if (!id || !status) return false;

  const first = Array.isArray(p.errors)
    ? (p.errors[0] as { code?: unknown; title?: string; detail?: string } | undefined)
    : undefined;
  const error =
    status === "failed"
      ? explainTextError(
          first?.code ? String(first.code) : undefined,
          first?.detail ?? first?.title,
        )
      : null;

  const rows = (await db.execute(sql`
    update call_sms
    set status = ${status}, error = coalesce(${error}::text, error)
    where telnyx_message_id = ${id}
      and direction = 'out'
      and (case status
        when 'sent' then 1 when 'delivered' then 2 when 'failed' then 2 else 0
      end) < ${RANK[status]}::int
    returning id
  `)) as Row[];
  return rows.length > 0;
}

/**
 * A text from outside.
 *
 * Attached to the conversation it answers rather than guessed from the number
 * alone: the latest text we sent *to* this number *from* the number it arrived
 * on says which meeting and lead it belongs to, and who is waiting on it. Only
 * a text with no such conversation falls back to matching the lead by phone,
 * the way inbound calls do, and to whoever holds the number it came in on.
 *
 * Stored even when it matches nothing. A text nobody can see is the failure to
 * avoid, and the row is cheap.
 *
 * The push is not held for quiet hours the way meeting reminders are: a reply
 * to "I'm calling you now" matters in the next two minutes, not at eight
 * tomorrow.
 */
/**
 * The attachments on an inbound MMS, as `SmsMedia`.
 *
 * Every field is read defensively because this is a webhook body: an item with
 * no url is dropped rather than stored as a row pointing nowhere, and a
 * missing content type becomes the generic one so the thread still offers it
 * as a file instead of rendering a broken picture.
 */
function parseMedia(raw: unknown): SmsMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: SmsMedia[] = [];
  for (const item of raw) {
    const m = item as Record<string, unknown> | null;
    const url = typeof m?.url === "string" ? m.url : "";
    if (!url) continue;
    out.push({
      url,
      contentType:
        typeof m?.content_type === "string" && m.content_type
          ? m.content_type
          : "application/octet-stream",
      size: typeof m?.size === "number" ? m.size : null,
      hash: typeof m?.hash_sha256 === "string" ? m.hash_sha256 : null,
    });
  }
  return out;
}

export async function recordInboundText(
  p: Record<string, unknown>,
): Promise<{ stored: boolean; notified: number }> {
  const id = String(p.id ?? "");
  const from = String(
    (p.from as { phone_number?: string } | undefined)?.phone_number ?? "",
  );
  const to = String(
    (Array.isArray(p.to)
      ? (p.to[0] as { phone_number?: string } | undefined)
      : undefined
    )?.phone_number ?? "",
  );
  if (!id || !from || !to) return { stored: false, notified: 0 };

  const text = typeof p.text === "string" ? p.text.trim() : "";
  // Kept, not counted. Until 2026-09-16 this read `p.media.length` and threw
  // the urls away, so the CRM knew a photo existed and could never show it.
  const items = parseMedia(p.media);
  const media = items.length;
  // A picture has no text, and an empty bubble reads as a bug. Still written
  // even though the thread now renders the attachment itself: it is what the
  // conversation list shows as the preview line, and it is the fallback for a
  // file whose bytes have aged out of Telnyx's bucket.
  const body =
    [
      text,
      media === 1
        ? "[They sent a picture or file]"
        : media > 1
          ? `[They sent ${media} pictures or files]`
          : "",
    ]
      .filter(Boolean)
      .join("\n") || "[Empty text]";

  const keys = phoneKeyCandidates(from);
  const leadByPhone =
    keys.length > 0
      ? sql`(select id from call_lead where phone_key in ${inList(keys)}
             order by duplicate_of_lead_id nulls first, id limit 1)`
      : sql`null::int`;

  const rows = (await db.execute(sql`
    with convo as (
      select meeting_id, call_lead_id, user_id from call_sms
      where direction = 'out' and to_number = ${from} and from_number = ${to}
      order by created_at desc, id desc
      limit 1
    ),
    lead as (
      select coalesce((select call_lead_id from convo), ${leadByPhone}) as id
    )
    insert into call_sms (
      telnyx_message_id, direction, from_number, to_number, body, status,
      media, meeting_id, call_lead_id, user_id
    )
    select ${id}, 'in', ${from}, ${to}, ${body}, 'received',
      ${media > 0 ? JSON.stringify(items) : null}::jsonb,
      coalesce(
        (select meeting_id from convo),
        (select m.id from call_meeting m
         where m.call_lead_id = (select id from lead)
         order by m.start_at desc limit 1)
      ),
      (select id from lead),
      coalesce(
        (select user_id from convo),
        -- Ordered, unlike the inbound-call lookup it mirrors: two people on one
        -- number otherwise get whichever row Postgres returns first.
        (select u.id from app_user u
         where u.telnyx_did = ${to} and u.active
         order by u.id limit 1)
      )
    on conflict (telnyx_message_id) do nothing
    returning call_lead_id, user_id
  `)) as Row[];

  // Nothing returned is a retry of a text already stored and already pushed.
  const row = rows[0];
  if (!row) return { stored: false, notified: 0 };

  const leadId = row.call_lead_id === null ? null : Number(row.call_lead_id);
  const userId = row.user_id === null ? null : Number(row.user_id);
  if (userId === null) return { stored: true, notified: 0 };

  let who: string | null = null;
  if (leadId !== null) {
    const [lead] = (await db.execute(sql`
      select coalesce(nullif(company, ''), name) as who
      from call_lead where id = ${leadId}
    `)) as Row[];
    who = (lead?.who as string | null) ?? null;
  }

  const notified = await pushToUser(userId, {
    // Laid out the way a phone lays out a text: who, then what they said.
    title: who ?? from,
    body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
    // Straight into the conversation. It opened Meetings until 2026-09-15,
    // when a founder's demo thread was the only place a reply could be read.
    url: conversationHref(from, to),
    // Per conversation, so a second text replaces the first notification
    // rather than stacking behind it.
    tag: `cylrm-sms-${from}-${to}`,
  });
  return { stored: true, notified };
}
