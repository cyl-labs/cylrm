import "server-only";
import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { phoneKeyCandidates } from "@/lib/calls";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";
import type { CurrentUser } from "@/lib/session";
import { optedOutOf, smsEnabled, type SmsStatus } from "@/lib/sms";
import { conversationKey } from "@/lib/text-key";

/**
 * The Texts screen: every text to and from our numbers, as conversations.
 *
 * Built to read like the Messages app on a phone (2026-09-15), because the
 * people reading it already know how that works and should not have to learn a
 * second way. A conversation is one other number on one of ours — see
 * `lib/text-key.ts` for why both halves.
 *
 * Scoped like missed calls: a caller sees texts to their own number, an admin
 * sees every conversation. By `call_sms.user_id` rather than by the number, so
 * a number handed to somebody new does not hand them the last holder's texts.
 */

export type TextMessage = {
  id: number;
  direction: "in" | "out";
  body: string;
  status: SmsStatus;
  /** Why an outbound text did not arrive, already in words. */
  error: string | null;
  /** Who sent it, outbound only. */
  byName: string | null;
  at: string;
};

export type Conversation = {
  key: string;
  /** The other person's number. */
  their: string;
  /** Which of our numbers it is on. */
  ours: string;
  /** Whose number `ours` is, for an admin reading everybody's. */
  oursName: string | null;
  /** The business, else the person's name, else null for a number we hold no
   *  lead for. */
  name: string | null;
  leadId: number | null;
  listId: number | null;
  listName: string | null;
  /** Why this number may not be rung, the same block every calling screen
   *  applies. */
  dncBlock: string | null;
  /** Null only for a conversation nobody has texted in yet — a founder opening
   *  a new one. */
  last: { body: string; direction: "in" | "out"; status: SmsStatus; at: string } | null;
  /** Texts in it that the signed-in person has not opened. */
  unread: number;
};

export type Thread = {
  conversation: Conversation;
  messages: TextMessage[];
  /** Their latest keyword was STOP, so Telnyx will refuse anything further. */
  optedOut: boolean;
};

type Row = Record<string, unknown>;

const scope = (me: CurrentUser | null): SQL =>
  !me
    ? sql`false`
    : me.role === "admin"
      ? sql`true`
      : sql`s.user_id = ${me.id}`;

const iso = (v: unknown) => new Date(v as string).toISOString();

function lead(r: Row, their: string) {
  return {
    name:
      ((r.company as string | null) || (r.lead_name as string | null)) ?? null,
    leadId: r.lead_id === null || r.lead_id === undefined ? null : Number(r.lead_id),
    listId: r.list_id === null || r.list_id === undefined ? null : Number(r.list_id),
    listName: (r.list_name as string | null) ?? null,
    dncBlock:
      r.lead_id === null || r.lead_id === undefined
        ? null
        : dncBlockReason(
            {
              dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
              dncCheckedAt: r.dnc_checked_at ? iso(r.dnc_checked_at) : null,
            },
            dialCountry(their),
          ),
  };
}

/** Every conversation, most recent first, as the list down the left. */
export async function getConversations(
  me: CurrentUser | null,
): Promise<Conversation[]> {
  if (!smsEnabled() || !me) return [];

  const rows = (await db.execute(sql`
    with m as (
      select s.id, s.direction, s.body, s.status, s.created_at, s.read_at,
        s.user_id, s.call_lead_id,
        case when s.direction = 'in' then s.from_number else s.to_number end as their,
        case when s.direction = 'in' then s.to_number else s.from_number end as ours
      from call_sms s
      where ${scope(me)}
    ),
    c as (
      select their, ours,
        count(*) filter (
          where direction = 'in' and read_at is null and user_id = ${me.id}
        )::int as unread,
        (array_agg(call_lead_id order by created_at desc, id desc)
          filter (where call_lead_id is not null))[1] as lead_id
      from m
      group by their, ours
    )
    select c.their, c.ours, c.unread, c.lead_id,
      last.body, last.direction, last.status, last.created_at,
      l.company, l.name as lead_name, l.dnc_status, l.dnc_checked_at,
      cl.id as list_id, cl.name as list_name,
      holder.name as ours_name
    from c
    join lateral (
      select body, direction, status, created_at from m
      where m.their = c.their and m.ours = c.ours
      order by created_at desc, id desc
      limit 1
    ) last on true
    left join call_lead l on l.id = c.lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join lateral (
      select u.name from app_user u
      where u.telnyx_did = c.ours
      order by u.active desc, u.id
      limit 1
    ) holder on true
    order by last.created_at desc
    limit 200
  `)) as Row[];

  return rows.map((r) => {
    const their = String(r.their);
    const ours = String(r.ours);
    return {
      key: conversationKey(their, ours),
      their,
      ours,
      oursName: (r.ours_name as string | null) ?? null,
      ...lead(r, their),
      last: {
        body: String(r.body ?? ""),
        direction: r.direction === "in" ? "in" : "out",
        status: r.status as SmsStatus,
        at: iso(r.created_at),
      },
      unread: Number(r.unread ?? 0),
    };
  });
}

/**
 * A conversation with nothing in it yet, for a founder starting one.
 *
 * Only ever built for an admin texting from their own number, so there is no
 * scope to apply: the lead is looked up the way an inbound text's is, by the
 * number, and nothing is revealed that the Spreadsheet does not already show.
 */
export async function blankConversation(
  their: string,
  ours: string,
): Promise<Conversation> {
  const found = await leadForNumber(their);
  const [holder] = (await db.execute(sql`
    select name from app_user where telnyx_did = ${ours}
    order by active desc, id limit 1
  `)) as Row[];
  return {
    key: conversationKey(their, ours),
    their,
    ours,
    oursName: (holder?.name as string | null) ?? null,
    name: found?.name ?? null,
    leadId: found?.id ?? null,
    listId: found?.listId ?? null,
    listName: found?.listName ?? null,
    dncBlock: found?.dncBlock ?? null,
    last: null,
    unread: 0,
  };
}

/** Every text in one conversation, oldest first, the way a thread reads. */
export async function getThreadMessages(
  me: CurrentUser | null,
  their: string,
  ours: string,
): Promise<TextMessage[]> {
  if (!smsEnabled() || !me) return [];
  const rows = (await db.execute(sql`
    select s.id, s.direction, s.body, s.status, s.error, s.created_at,
      u.name as by_name
    from call_sms s
    left join app_user u on u.id = s.user_id and s.direction = 'out'
    where (
        (s.direction = 'in' and s.from_number = ${their} and s.to_number = ${ours})
        or (s.direction = 'out' and s.to_number = ${their} and s.from_number = ${ours})
      )
      and ${scope(me)}
    order by s.created_at asc, s.id asc
    limit 500
  `)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    direction: r.direction === "in" ? "in" : "out",
    body: String(r.body ?? ""),
    status: r.status as SmsStatus,
    error: (r.error as string | null) ?? null,
    byName: (r.by_name as string | null) ?? null,
    at: iso(r.created_at),
  }));
}

/**
 * Has this person texted STOP to this number of ours?
 *
 * Read off the texts themselves, the same way the Meetings thread reads it, so
 * the send button and the thread cannot disagree about it. Telnyx refuses the
 * send regardless; asking first lets the screen say why.
 */
export async function conversationOptedOut(
  their: string,
  ours: string,
): Promise<boolean> {
  const rows = (await db.execute(sql`
    select body from call_sms
    where direction = 'in' and from_number = ${their} and to_number = ${ours}
    order by created_at asc, id asc
  `)) as Row[];
  return optedOutOf(rows.map((r) => String(r.body ?? "")));
}

/**
 * The lead behind a number, and its latest meeting.
 *
 * Duplicates last, the way an inbound text is matched, so a number held on two
 * lists resolves to the original rather than to the copy the importer flagged.
 */
export async function leadForNumber(phone: string): Promise<{
  id: number;
  name: string | null;
  listId: number | null;
  listName: string | null;
  meetingId: number | null;
  dncBlock: string | null;
} | null> {
  const keys = phoneKeyCandidates(phone);
  if (keys.length === 0) return null;
  const [r] = (await db.execute(sql`
    select l.id as lead_id, l.company, l.name as lead_name,
      l.dnc_status, l.dnc_checked_at,
      cl.id as list_id, cl.name as list_name,
      (select m.id from call_meeting m where m.call_lead_id = l.id
        order by m.start_at desc limit 1) as meeting_id
    from call_lead l
    left join call_list cl on cl.id = l.call_list_id
    where l.phone_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    order by l.duplicate_of_lead_id nulls first, l.id
    limit 1
  `)) as Row[];
  if (!r) return null;
  const found = lead(r, phone);
  return {
    id: Number(r.lead_id),
    name: found.name,
    listId: found.listId,
    listName: found.listName,
    meetingId: r.meeting_id === null ? null : Number(r.meeting_id),
    dncBlock: found.dncBlock,
  };
}

/**
 * Mark a conversation's texts as read by the person they are for.
 *
 * Nobody else's reading counts: a founder opening a caller's conversation must
 * not clear the caller's dot, or the one person who has to act on it is told
 * there is nothing new.
 */
export async function markConversationRead(
  me: CurrentUser,
  their: string,
  ours: string,
): Promise<number> {
  const rows = (await db.execute(sql`
    update call_sms set read_at = now()
    where direction = 'in' and read_at is null
      and user_id = ${me.id}
      and from_number = ${their} and to_number = ${ours}
    returning id
  `)) as Row[];
  return rows.length;
}

/**
 * Unread texts for the sidebar badge.
 *
 * `cache()`d for the reason `countMissedCalls` is: the sidebar and `PageShell`
 * both ask while rendering one page. Zero while texting is off, so the badge
 * query never reaches a table that may not exist.
 */
export const countUnreadTexts = cache(async function countUnreadTexts(
  me: CurrentUser | null,
): Promise<number> {
  if (!smsEnabled() || !me) return 0;
  const [row] = (await db.execute(sql`
    select count(*)::int as n from call_sms
    where direction = 'in' and read_at is null and user_id = ${me.id}
  `)) as { n: number }[];
  return row?.n ?? 0;
});
