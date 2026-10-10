import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notAnsweredYet } from "@/lib/attendance-sql";
import { prospectZone } from "@/lib/call-time";
import { getMeeting } from "@/lib/meetings";
import { classifyPhone, e164 } from "@/lib/phone";
import {
  explainTextError,
  isOptedOut,
  recordOutbound,
  settleOutbound,
  smsEnabled,
} from "@/lib/sms";
import { sendSms } from "@/lib/telnyx";
import { callerNumberOf } from "@/lib/users";

/**
 * A text to the prospect shortly before their demo (2026-10-10).
 *
 * The booking is low friction: "we call you at 2pm on Thursday". The no-shows
 * are people who were busy and forgot, and Cal.com's two emails (24h and 1h
 * before) do not reach a tradesman on a job site. Show rate was 41% overall and
 * 29% over the last two weeks. It is a reminder, not a confirmation: it asks
 * for no reply, because ringing or texting to ask "are you still coming?" hands
 * them an easy moment to say no, which is why the old confirmation call went
 * (see docs/meetings.md).
 *
 * - **Off unless `DEMO_TEXT_REMINDERS=1`**, and texting itself must be on
 *   (`TELNYX_SMS_ENABLED`). Unset it and restart to stop.
 * - **Demos only**, not follow-ups, not practice meetings.
 * - **Once per booked time.** The claim reuses `meeting_reminder_sent`, whose
 *   key carries `for_start_at`, so a moved demo is reminded about the new slot.
 * - **A failed send keeps its claim**, the opposite of the Telegram alert. A
 *   text that Telnyx may have accepted must never be sent twice to a stranger
 *   because a retry looked reasonable.
 * - **From the closer's own number**, the one that will ring them; a demo with
 *   no closer yet falls back to the first active admin's number.
 * - Skipped, never queued: a booking made less than an hour ahead (the booking
 *   was the reminder), a prospect already texted in the last 90 minutes, a STOP,
 *   a screened-out number, a non-US number, and 9pm to 7am in their zone.
 * - No company name, same as the manual demo-time text.
 */
export const demoTextRemindersEnabled = () =>
  smsEnabled() && process.env.DEMO_TEXT_REMINDERS === "1";

const KIND = "prospect_text";
/** Send from this long before the demo... */
const OPENS_MINUTES = 60;
/** ...until this long before it. Later than this is no use as a reminder. */
const CLOSES_MINUTES = 15;
const QUIET_BEFORE_HOUR = 7;
const QUIET_FROM_HOUR = 21;

type Row = Record<string, unknown>;

export type DemoTextResult = {
  considered: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  off?: string;
};

function localHour(at: Date, zone: string): number | null {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at);
    return Number(h);
  } catch {
    return null;
  }
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-z][A-Za-z'’-]{1,19}$/.test(first)) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

/** The words. Exported so the message can be read without sending one. */
export function reminderText(input: {
  name: string | null;
  startAt: Date;
  now: Date;
}): string {
  const minutes = Math.round((input.startAt.getTime() - input.now.getTime()) / 60_000);
  const away =
    minutes >= 50
      ? "in about an hour"
      : `in about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const hello = firstName(input.name);
  return `Hey${hello ? ` ${hello}` : ""}, just a heads up, calling you about your voice agent ${away}`;
}

async function senderNumber(closerUserId: number | null): Promise<{
  userId: number;
  number: string;
} | null> {
  if (closerUserId) {
    const number = await callerNumberOf(closerUserId);
    if (number) return { userId: closerUserId, number };
  }
  const [admin] = (await db.execute(sql`
    select id, telnyx_did from app_user
    where role = 'admin' and active and telnyx_did is not null
      and btrim(telnyx_did) <> ''
    order by id limit 1
  `)) as Row[];
  if (!admin) return null;
  return { userId: Number(admin.id), number: String(admin.telnyx_did).trim() };
}

export async function sendDemoTextReminders(
  now: Date = new Date(),
): Promise<DemoTextResult> {
  const result: DemoTextResult = { considered: 0, sent: 0, failed: 0, skipped: {} };
  const skip = (why: string) => {
    result.skipped[why] = (result.skipped[why] ?? 0) + 1;
  };
  if (!demoTextRemindersEnabled()) return { ...result, off: "switched off" };

  const iso = now.toISOString();
  const candidates = (await db.execute(sql`
    select m.id, m.start_at
    from call_meeting m
    where m.status = 'accepted' and m.kind = 'demo' and not m.training
      and ${notAnsweredYet("m")}
      and m.start_at > ${iso}::timestamptz + make_interval(mins => ${CLOSES_MINUTES}::int)
      and m.start_at <= ${iso}::timestamptz + make_interval(mins => ${OPENS_MINUTES}::int)
      -- A booking made inside the hour was its own reminder.
      and m.created_at < m.start_at - make_interval(mins => ${OPENS_MINUTES}::int)
      and not exists (
        select 1 from meeting_reminder_sent r
        where r.meeting_id = m.id and r.kind = ${KIND} and r.for_start_at = m.start_at
      )
    order by m.start_at
  `)) as Row[];
  result.considered = candidates.length;

  for (const c of candidates) {
    const id = Number(c.id);
    const startAt = new Date(c.start_at as string);
    const meeting = await getMeeting(id);
    if (!meeting || meeting.leadId === null || !meeting.phone) {
      skip("no phone");
      continue;
    }
    if (meeting.dncBlock) {
      skip("screened out");
      continue;
    }
    const to = classifyPhone(meeting.phone) === "us" ? e164(meeting.phone) : null;
    if (!to) {
      skip("not a US number");
      continue;
    }
    const zone = prospectZone(meeting.leadTz, meeting.attendeeTz);
    const hour = zone ? localHour(now, zone) : null;
    if (hour !== null && (hour < QUIET_BEFORE_HOUR || hour >= QUIET_FROM_HOUR)) {
      skip("quiet hours");
      continue;
    }
    if (await isOptedOut(meeting.leadId)) {
      skip("replied STOP");
      continue;
    }
    const [recent] = (await db.execute(sql`
      select 1 from call_sms
      where call_lead_id = ${meeting.leadId} and direction = 'out'
        and created_at > ${iso}::timestamptz - interval '90 minutes'
      limit 1
    `)) as Row[];
    if (recent) {
      skip("texted recently");
      continue;
    }
    const sender = await senderNumber(meeting.closerUserId);
    if (!sender || classifyPhone(sender.number) !== "us") {
      skip("no US sender number");
      continue;
    }

    // Claim first, as an insert: two overlapping ticks cannot both win it.
    const claimed = (await db.execute(sql`
      insert into meeting_reminder_sent (meeting_id, kind, for_start_at, user_id)
      values (${id}, ${KIND}, ${c.start_at as string}, ${sender.userId})
      on conflict (meeting_id, kind, for_start_at) do nothing
      returning id
    `)) as Row[];
    if (claimed.length === 0) continue;

    const body = reminderText({ name: meeting.attendeeName, startAt, now });
    const sent = await sendSms(sender.number, to, body);
    if (!sent.ok) {
      result.failed += 1;
      console.error(
        `Demo text reminder for meeting ${id} failed:`,
        sent.code === "unreachable"
          ? "Telnyx never answered; it may have gone"
          : explainTextError(sent.code, sent.detail),
      );
      continue;
    }
    await recordOutbound({
      telnyxId: sent.id,
      from: sender.number,
      to,
      body,
      status: sent.status,
      meetingId: id,
      leadId: meeting.leadId,
      userId: sender.userId,
    });
    void settleOutbound(sent.id);
    result.sent += 1;
  }
  return result;
}
