import "server-only";
import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { SmsMedia } from "@/db/schema";
import { phoneKeyCandidates } from "@/lib/calls";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";
import { callScope, type CurrentUser } from "@/lib/session";
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
  /**
   * Pictures and files on the text, in the order they arrived.
   *
   * **Deliberately carries no url.** The stored one is a public Telnyx S3
   * object, so the browser gets a type and a size and fetches the bytes from
   * `/api/texts/media/<id>?i=<index>`, which checks who is asking. Shipping
   * the url to the page would make every attachment readable by anyone who
   * ever saw the HTML.
   */
  media: { contentType: string; size: number | null }[];
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
  /** The signed-in person has sent a text in it themselves — a conversation
   *  somebody is actually having, which Texts lifts above the automatic
   *  "sorry we missed your call" replies (2026-09-24). */
  replied: boolean;
  /** Where their demo stands, or null for a business that never booked one.
   *  These are the conversations worth reading; most of the rest are automatic
   *  "sorry we missed your call" replies. */
  demo: ConversationDemo | null;
  /** The signed-in person archived it and nothing has arrived since. Theirs
   *  alone — see `archiveConversation`. */
  archived: boolean;
};

export type ConversationDemo = {
  /** When the booking is, or was. Null for a demo logged on a call and never
   *  put on the calendar. */
  at: string | null;
  state: "upcoming" | "past" | "cancelled" | "showed_up" | "no_show" | "unbooked";
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
        bool_or(direction = 'out' and user_id = ${me.id}) as replied,
        (array_agg(call_lead_id order by created_at desc, id desc)
          filter (where call_lead_id is not null))[1] as lead_id
      from m
      group by their, ours
    )
    select c.their, c.ours, c.unread, c.replied, c.lead_id,
      last.body, last.direction, last.status, last.created_at,
      l.company, l.name as lead_name, l.dnc_status, l.dnc_checked_at,
      cl.id as list_id, cl.name as list_name,
      holder.name as ours_name,
      mt.start_at as demo_at, mt.status as demo_status,
      mt.upcoming as demo_upcoming, mt.attendance as demo_attendance,
      d.has_demo,
      (ar.archived_at is not null and ar.archived_at >= last.created_at) as archived
    from c
    join lateral (
      select body, direction, status, created_at from m
      where m.their = c.their and m.ours = c.ours
      order by created_at desc, id desc
      limit 1
    ) last on true
    left join call_sms_archive ar
      on ar.user_id = ${me.id} and ar.their_number = c.their and ar.our_number = c.ours
    left join call_lead l on l.id = c.lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join lateral (
      select u.name from app_user u
      where u.telnyx_did = c.ours
      order by u.active desc, u.id
      limit 1
    ) holder on true
    -- Their booking, live ones before cancelled ones: a prospect who cancelled
    -- Thursday and rebooked for Wednesday is booked, not cancelled. The
    -- attendance answer is read the way Meetings reads it — only one given
    -- after the meeting began can be about it.
    left join lateral (
      select mm.start_at, mm.status, mm.start_at > now() as upcoming,
        (
          select a.status from call_demo_attendance a
          where a.call_lead_id = mm.call_lead_id and a.marked_at >= mm.start_at
          order by a.marked_at desc limit 1
        ) as attendance
      from call_meeting mm
      where mm.call_lead_id = c.lead_id
      order by (mm.status = 'accepted') desc, mm.start_at desc
      limit 1
    ) mt on true
    -- A booking decides, unless a founder marked it "not a real booking" (a
    -- test, a duplicate, the wrong lead). With no booking, a demo logged on a
    -- call still counts: it is one nobody put on the calendar.
    cross join lateral (
      select case
        when mt.start_at is not null then mt.attendance is distinct from 'invalid'
        else exists (
          select 1 from call dc
          where dc.call_lead_id = c.lead_id and dc.outcome = 'demo_booked'
        )
      end as has_demo
    ) d
    -- Archived last, so a pile of put-away threads can never push a live one
    -- past the limit. Then demo businesses, then ones this person has replied
    -- to, so the limit can never push either off the list.
    order by archived asc, d.has_demo desc, c.replied desc, last.created_at desc
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
      replied: r.replied === true,
      demo: demoOf(r),
      archived: r.archived === true,
    };
  });
}

function demoOf(r: Row): ConversationDemo | null {
  if (r.has_demo !== true) return null;
  if (!r.demo_at) return { at: null, state: "unbooked" };
  const at = iso(r.demo_at);
  // Cal.com's other refusal, "rejected", means the same to whoever reads this.
  if (r.demo_status === "cancelled" || r.demo_status === "rejected") {
    return { at, state: "cancelled" };
  }
  if (r.demo_attendance === "showed_up" || r.demo_attendance === "no_show") {
    return { at, state: r.demo_attendance };
  }
  return { at, state: r.demo_upcoming === true ? "upcoming" : "past" };
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
    replied: false,
    // Only the conversation list reads this, and a blank conversation is
    // never in the list.
    demo: null,
    archived: false,
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
    select s.id, s.direction, s.body, s.status, s.error, s.created_at, s.media,
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
    // Type and size only. The url is deliberately dropped here — see
    // `TextMessage.media` and `/api/texts/media/[id]`.
    media: (Array.isArray(r.media) ? (r.media as SmsMedia[]) : []).map((m) => ({
      contentType: m.contentType || "application/octet-stream",
      size: typeof m.size === "number" ? m.size : null,
    })),
  }));
}

/**
 * One attachment, if this person is allowed to see it.
 *
 * The conversation scoping rule and not a second copy of it: `scope(me)` is
 * the same clause the thread itself is read through, so a caller can reach
 * exactly the attachments on texts to their own number and an admin can reach
 * all of them. Two copies of "may you see this" is how the two end up
 * disagreeing, and the one that is wrong here hands out a prospect's
 * photograph.
 *
 * Returns the stored `SmsMedia`, url included — this runs on the server for
 * `/api/texts/media/[id]`, which is the only thing that may hold that value.
 */
export async function findVisibleTextMedia(
  messageId: number,
  index: number,
  me: CurrentUser | null,
): Promise<SmsMedia | null> {
  if (!smsEnabled() || !me) return null;
  const rows = (await db.execute(sql`
    select s.media from call_sms s
    where s.id = ${messageId} and s.media is not null and ${scope(me)}
    limit 1
  `)) as Row[];
  const media = rows[0]?.media;
  if (!Array.isArray(media)) return null;
  const item = (media as SmsMedia[])[index];
  return item && typeof item.url === "string" && item.url ? item : null;
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

type LeadMatch = {
  id: number;
  name: string | null;
  listId: number | null;
  listName: string | null;
  meetingId: number | null;
  dncBlock: string | null;
};

async function leadWhere(where: SQL, phone: string): Promise<LeadMatch | null> {
  const [r] = (await db.execute(sql`
    select l.id as lead_id, l.company, l.name as lead_name,
      l.dnc_status, l.dnc_checked_at,
      cl.id as list_id, cl.name as list_name,
      (select m.id from call_meeting m where m.call_lead_id = l.id
        order by m.start_at desc limit 1) as meeting_id
    from call_lead l
    left join call_list cl on cl.id = l.call_list_id
    where ${where}
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
 * The lead behind a number, and its latest meeting.
 *
 * Duplicates last, the way an inbound text is matched, so a number held on two
 * lists resolves to the original rather than to the copy the importer flagged.
 */
export async function leadForNumber(phone: string): Promise<LeadMatch | null> {
  const keys = phoneKeyCandidates(phone);
  if (keys.length === 0) return null;
  return leadWhere(
    sql`l.phone_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
    phone,
  );
}

/**
 * The lead a conversation is about: the one its texts carry, else the one the
 * number matches.
 *
 * The texts come first because somebody may have linked the conversation by
 * hand (`linkConversation`) — an owner texting from their own mobile, which
 * matches no lead, or matches the wrong one. Reading the number alone would
 * unlink it on the next reply.
 */
export async function leadForConversation(
  their: string,
  ours: string,
): Promise<LeadMatch | null> {
  const [row] = (await db.execute(sql`
    select call_lead_id from call_sms
    where call_lead_id is not null
      and (
        (direction = 'in' and from_number = ${their} and to_number = ${ours})
        or (direction = 'out' and to_number = ${their} and from_number = ${ours})
      )
    order by created_at desc, id desc
    limit 1
  `)) as Row[];
  if (row) {
    const linked = await leadWhere(sql`l.id = ${Number(row.call_lead_id)}`, their);
    if (linked) return linked;
  }
  return leadForNumber(their);
}

/** Businesses to link a conversation to, by name or by number. Scoped the way
 *  every calling query is: a caller searches their own lists. */
export async function searchLeadsToLink(
  me: CurrentUser,
  q: string,
): Promise<{ id: number; name: string; phone: string; listName: string | null }[]> {
  const text = q.trim();
  const digits = text.replace(/\D/g, "");
  if (text.length < 2) return [];
  const owner = callScope(me);
  const rows = (await db.execute(sql`
    select l.id, coalesce(l.company, l.name, l.phone) as name, l.phone,
      cl.name as list_name
    from call_lead l
    left join call_list cl on cl.id = l.call_list_id
    where (
        l.company ilike ${"%" + text + "%"}
        or l.name ilike ${"%" + text + "%"}
        ${digits.length >= 3 ? sql`or l.phone_key like ${"%" + digits + "%"}` : sql``}
      )
      and l.duplicate_of_lead_id is null
      ${owner === undefined ? sql`` : sql`and cl.assigned_user_id = ${owner}`}
    order by l.company nulls last, l.id
    limit 8
  `)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    phone: String(r.phone),
    listName: (r.list_name as string | null) ?? null,
  }));
}

/**
 * Say which business a conversation is about (2026-09-24).
 *
 * An owner often texts from their own mobile rather than the business line we
 * rang, so the number matches no lead and the conversation sat under
 * "Everyone else" with no name and no demo. This stamps the chosen lead on
 * every text in it; both the inbound webhook and the send route then carry it
 * forward from the conversation, so it stays linked. The latest meeting is
 * stamped too, the way a matched text's is.
 *
 * A caller may only link conversations on their own number, to a lead on
 * their own lists. Returns false when the lead is out of reach.
 */
export async function linkConversation(
  me: CurrentUser,
  their: string,
  ours: string,
  leadId: number,
): Promise<boolean> {
  const owner = callScope(me);
  const rows = (await db.execute(sql`
    with target as (
      select l.id,
        (select m.id from call_meeting m where m.call_lead_id = l.id
          order by m.start_at desc limit 1) as meeting_id
      from call_lead l
      left join call_list cl on cl.id = l.call_list_id
      where l.id = ${leadId}
        ${owner === undefined ? sql`` : sql`and cl.assigned_user_id = ${owner}`}
    )
    update call_sms s
    set call_lead_id = target.id, meeting_id = target.meeting_id
    from target
    where (
        (s.direction = 'in' and s.from_number = ${their} and s.to_number = ${ours})
        or (s.direction = 'out' and s.to_number = ${their} and s.from_number = ${ours})
      )
      and ${scope(me)}
    returning s.id
  `)) as Row[];
  return rows.length > 0;
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

/**
 * Archive a conversation for the person asking, or bring it back.
 *
 * Theirs alone, the way read receipts are: a founder putting away a caller's
 * thread must not hide it from the caller who has to answer it. Archiving
 * marks it read as well, or the sidebar badge would go on counting texts the
 * person has deliberately put away.
 *
 * Only a conversation they can already see: the same `scope()` the list is
 * read through, so this cannot be used to learn that a thread exists.
 */
export async function archiveConversation(
  me: CurrentUser,
  their: string,
  ours: string,
  archived: boolean,
): Promise<boolean> {
  const [visible] = (await db.execute(sql`
    select 1 from call_sms s
    where ${scope(me)}
      and ((s.direction = 'in' and s.from_number = ${their} and s.to_number = ${ours})
        or (s.direction = 'out' and s.to_number = ${their} and s.from_number = ${ours}))
    limit 1
  `)) as Row[];
  if (!visible) return false;
  if (!archived) {
    await db.execute(sql`
      delete from call_sms_archive
      where user_id = ${me.id} and their_number = ${their} and our_number = ${ours}
    `);
    return true;
  }
  await db.execute(sql`
    insert into call_sms_archive (user_id, their_number, our_number)
    values (${me.id}, ${their}, ${ours})
    on conflict (user_id, their_number, our_number)
      do update set archived_at = now()
  `);
  await markConversationRead(me, their, ours);
  return true;
}
