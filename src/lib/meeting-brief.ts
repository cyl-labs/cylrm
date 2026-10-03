/**
 * A short briefing on each upcoming demo, written from the call that won it.
 *
 * Asked for as "a summary of each of the booked meetings that are coming up —
 * it will be useful to know the context of each call". The person taking a
 * demo is usually not the caller who booked it, and until now the handover was
 * whatever notes that caller typed while the prospect was still talking.
 * Measured on the 14 upcoming meetings the day this was built: **3 had notes**,
 * 210 characters on average, while **13 had a recording** and 11 of those were
 * already transcribed. The context existed. It was sitting in audio nobody was
 * going to listen to twelve minutes before a demo.
 *
 * So the transcript is the source, not the notes. The notes are included when
 * they exist, because a caller writing something down chose to, and that is
 * worth more per word than anything said in passing on the call.
 *
 * Plain `fetch` against OpenAI in the shape `objection-match.ts` and
 * `deepgram.ts` established: no SDK, a `configured()` gate so an unset key is a
 * quiet failure rather than a crash, and errors that name the vendor.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { answersMeeting } from "@/lib/attendance-sql";
import { leadZone } from "@/lib/calls";
import { transcribeUrl, transcriptionConfigured } from "@/lib/deepgram";
import { recordingDownloadUrl } from "@/lib/telnyx";
import type { TranscriptTurn } from "@/db/schema";
import type { StoredBrief } from "@/lib/brief-lines";
import { recordAiUsage } from "@/lib/ai-usage";

const API = "https://api.openai.com/v1/chat/completions";

/**
 * `gpt-4.1-mini`, the same model the live objection hints use.
 *
 * Not chosen afresh: it is already the measured choice in this codebase for
 * reading call transcripts, the key is already configured, and a second model
 * would be a second thing to evaluate whenever either moves. Speed does not
 * matter here the way it does on a live call — this runs on a button press,
 * not while a prospect is talking — so the argument that settled that one
 * applies with room to spare.
 */
// `gpt-4.1` since 2026-10-04 (was `gpt-4.1-mini`). Compared on 7 real calls with
// the same prompt: the same speed (about 2.8 s against 2.7 s) but far better at
// following the written rules, and about five times the price, which is still
// cents a month. The live objection hints stay on the mini, where speed matters.
export const BRIEF_MODEL = "gpt-4.1";

/** "Mon, Oct 5, 10:00 AM CDT (their time)" for the booked slot. */
function slotLabel(at: Date, tz: string | null): string {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
  return tz ? `${text} (their time)` : `${text} (we could not tell their zone)`;
}

/** The Time line when the recording has no time being agreed in it. Says what
 *  the calendar holds instead, because "no time came up" read as a gap in the
 *  briefing rather than a fact about the recording. */
const noTimeLine = (s: BriefSource) =>
  s.bookedFor
    ? "- Time: Not discussed in this recording (it may have been agreed on another call, or booked from a link)."
    : "- Time: Not discussed in this recording (it may have been agreed on another call, or booked from a link).";

const MODEL = BRIEF_MODEL;

/** Per meeting. A 14-minute transcript is the longest seen so far and lands
 *  well inside this; the timeout is here so one bad call cannot hang the
 *  whole document. */
const TIMEOUT_MS = 45_000;

/**
 * How much transcript to send.
 *
 * The longest booking call on the board is 14 minutes, roughly 12k characters.
 * The cap is not really about cost — it is about the model's attention: a
 * cold call's useful half is almost always the middle, after the pitch and
 * before the diary, and padding it with a long goodbye buys nothing. Anything
 * over this is trimmed from the *front*, since the end of a booking call is
 * where the commitment and the objections are.
 */
const MAX_TRANSCRIPT_CHARS = 14_000;

export const briefConfigured = () => Boolean(process.env.OPENAI_API_KEY);

/** Everything the brief is written from. Gathered in one place so the
 *  fingerprint and the prompt cannot fall out of step: whatever goes into the
 *  hash is exactly what the model was shown. */
export type BriefSource = {
  meetingId: number;
  company: string;
  niche: string | null;
  bookedBy: string | null;
  notes: string | null;
  /** Newest last, as `speaker: text` lines. */
  transcript: string | null;
  transcriptMinutes: number | null;
  /**
   * Whether a recording exists at all, which is a different question from
   * whether there is a transcript.
   *
   * Conflating the two is what the first version got wrong: two upcoming demos
   * showed "No recording or notes from the booking call" when both had one —
   * 6.2 and 8.0 minutes — that simply had not been transcribed. A brief that
   * says the call was never recorded, when it is sitting there, sends somebody
   * looking for a fault that does not exist.
   */
  hasRecording: boolean;
  /** When the meeting is booked for, in the prospect's own clock, already
   *  formatted (2026-10-04). For the one case the call cannot answer: a booking
   *  whose time was agreed somewhere the recording does not cover. */
  bookedFor: string | null;
  /** The lead's call outcomes, oldest first — "what has happened to this
   *  business so far", which a transcript of one call cannot say. */
  history: string[];
};

/**
 * A stable hash of the material a brief was written from.
 *
 * Only the content, never a timestamp or an id that moves on its own: the
 * whole value of this is that pressing the button twice with nothing changed
 * spends no money the second time.
 */
export function fingerprint(s: BriefSource): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        // The prompt too, so a brief written under older instructions reads
        // as out of date rather than as current.
        SYSTEM,
        s.company,
        s.niche,
        s.notes ?? "",
        s.transcript ?? "",
        s.bookedFor,
        s.history,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Gather the source material for every upcoming demo.
 *
 * One query per concern rather than one wide join: the transcript is a jsonb
 * blob per meeting and the history is a row per call, and fanning those out
 * against each other would multiply both. Scoped by the caller, so this
 * answers the same set of meetings the screen itself shows.
 */
export async function briefSources(
  meetingIds: number[],
): Promise<Map<number, BriefSource>> {
  const out = new Map<number, BriefSource>();
  if (meetingIds.length === 0) return out;
  const ids = sql.join(
    meetingIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const rows = (await db.execute(sql`
    select
      m.id as meeting_id,
      coalesce(l.company, m.attendee_name, 'Unlinked booking') as company,
      cl.niche as niche,
      bu.name as booked_by,
      bc.notes as notes,
      cr.transcript_turns as turns,
      cr.transcript_text as transcript_text,
      cr.recording_id as recording_id,
      cr.duration_ms as duration_ms,
      m.start_at as start_at,
      coalesce(z.tz, m.attendee_tz) as slot_tz,
      m.call_lead_id as lead_id
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join "call" bc on bc.id = m.call_id
    left join app_user bu on bu.id = bc.user_id
    ${leadZone}
    -- The conversation that won the meeting: the booking call's own recording
    -- when it ran 20 seconds or more, else the longest call to the same number
    -- from the same caller ID in the two hours before (a redial logged the
    -- booking and the real call was the one before it). Same rule as the joins
    -- in lib/meetings.ts.
    left join lateral (
      select r.* from call_recording r
      where bc.id is not null
        and (
          r.call_session_id = bc.telnyx_session_id
          or (
            r.to_number = '+' || l.phone_key
            and r.from_number = coalesce(bc.dialled_from, bu.telnyx_did)
            and r.started_at between bc.called_at - interval '2 hours' and bc.called_at
          )
        )
      order by
        (r.call_session_id = bc.telnyx_session_id and coalesce(r.duration_ms, 0) >= 20000) desc,
        r.duration_ms desc nulls last, r.id
      limit 1
    ) cr on true
    where m.id in (${ids})
  `)) as unknown as Record<string, unknown>[];

  // The lead's own call log, which one transcript cannot supply: a business
  // rung three times and booked on the third has two earlier answers that say
  // what it took.
  const historyRows = (await db.execute(sql`
    select m.id as meeting_id, c.outcome::text as outcome, c.called_at
    from call_meeting m
    join "call" c on c.call_lead_id = m.call_lead_id
    where m.id in (${ids})
    order by c.called_at asc, c.id asc
  `)) as unknown as Record<string, unknown>[];

  const history = new Map<number, string[]>();
  for (const h of historyRows) {
    const id = Number(h.meeting_id);
    const list = history.get(id) ?? [];
    list.push(String(h.outcome));
    history.set(id, list);
  }

  for (const r of rows) {
    const id = Number(r.meeting_id);
    const turns = Array.isArray(r.turns) ? (r.turns as TranscriptTurn[]) : null;
    // `transcript_turns` is the good one — speakers come from which channel
    // the audio was on, not from a model guessing. `transcript_text` is the
    // fallback for a recording transcribed before turns were stored.
    let transcript =
      turns && turns.length > 0
        ? turns
            .map((t) => `${t.speaker === "caller" ? "Our caller" : "Prospect"}: ${t.text}`)
            .join("\n")
        : ((r.transcript_text as string | null) ?? null);
    if (transcript && transcript.length > MAX_TRANSCRIPT_CHARS) {
      // From the front: the end of a booking call is where the commitment and
      // the objections are.
      transcript =
        "…(earlier part of the call trimmed)…\n" +
        transcript.slice(-MAX_TRANSCRIPT_CHARS);
    }
    const ms = r.duration_ms === null ? null : Number(r.duration_ms);
    out.set(id, {
      meetingId: id,
      company: String(r.company),
      niche: (r.niche as string | null) ?? null,
      bookedBy: (r.booked_by as string | null) ?? null,
      notes: ((r.notes as string | null) ?? "").trim() || null,
      transcript,
      transcriptMinutes: ms === null ? null : Math.round((ms / 60_000) * 10) / 10,
      hasRecording: Boolean(r.recording_id),
      bookedFor: r.start_at ? slotLabel(new Date(r.start_at as string), (r.slot_tz as string | null) ?? null) : null,
      history: history.get(id) ?? [],
    });
  }
  return out;
}

/**
 * Transcribe the booking calls that have a recording and no transcript yet.
 *
 * Transcription is otherwise on demand, because it is billed per minute and
 * transcribing every dial would be a standing bill for text nobody reads. The
 * briefing is the case where somebody *is* going to read it: these are the
 * handful of calls behind demos that are actually in the diary, and without
 * this the brief for one of them is a shrug.
 *
 * Bounded by the upcoming meetings, so the worst run is a dozen or so — and
 * only ever the first time, since the transcript is stored on the recording
 * and belongs to the call log afterwards as much as to this page.
 *
 * Every failure is swallowed on purpose. A recording Telnyx has since expired,
 * or one Deepgram cannot read, must leave the other thirteen briefs written:
 * the brief for that meeting then says a recording exists and could not be
 * read, which is true and is not the same sentence as "there is no recording".
 *
 * Returns how many were newly transcribed, for the message the button shows.
 */
export async function ensureTranscripts(
  meetingIds: number[],
): Promise<{ transcribed: number; failed: number }> {
  if (meetingIds.length === 0 || !transcriptionConfigured()) {
    return { transcribed: 0, failed: 0 };
  }

  const rows = (await db.execute(sql`
    select distinct cr.recording_id
    from call_meeting m
    join "call" bc on bc.id = m.call_id
    join call_lead l on l.id = m.call_lead_id
    left join app_user bu on bu.id = bc.user_id
    -- The same recording the brief reads, so the one that needs words is the
    -- real conversation and not a redial logged after it.
    join lateral (
      select r.* from call_recording r
      where r.call_session_id = bc.telnyx_session_id
        or (
          r.to_number = '+' || l.phone_key
          and r.from_number = coalesce(bc.dialled_from, bu.telnyx_did)
          and r.started_at between bc.called_at - interval '2 hours' and bc.called_at
        )
      order by
        (r.call_session_id = bc.telnyx_session_id and coalesce(r.duration_ms, 0) >= 20000) desc,
        r.duration_ms desc nulls last, r.id
      limit 1
    ) cr on true
    where m.id in (${sql.join(
      meetingIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      and cr.transcript_text is null
  `)) as unknown as Record<string, unknown>[];

  return transcribeRecordings(rows.map((r) => String(r.recording_id)));
}

/**
 * Transcribe these recordings and store the text on them. Shared by the briefing
 * and the demo call review. Failures are counted, never thrown.
 */
export async function transcribeRecordings(
  ids: string[],
): Promise<{ transcribed: number; failed: number }> {
  if (ids.length === 0 || !transcriptionConfigured()) {
    return { transcribed: 0, failed: 0 };
  }
  let transcribed = 0;
  let failed = 0;
  // Two at a time. Deepgram is given a URL and fetches the audio itself, so
  // this is mostly waiting — but a burst of presigned Telnyx links all being
  // pulled at once is the kind of thing that starts failing in ways that look
  // like the feature being broken.
  const queue = [...ids];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const url = await recordingDownloadUrl(id);
        if (!url) throw new Error("Telnyx has no download for that recording.");
        const transcript = await transcribeUrl(url);
        // Through Drizzle, never the raw postgres client: that one JSON-encodes
        // a parameter bound to jsonb and would store a string where the reader
        // expects an array, which fails silently and only on read.
        await db.execute(sql`
          update call_recording
          set transcript_text = ${transcript.text},
              transcript_turns = ${JSON.stringify(transcript.turns)}::jsonb,
              transcribed_at = now()
          where recording_id = ${id}
        `);
        transcribed += 1;
      } catch (err) {
        console.error("[meeting-brief] transcribe failed", id, err);
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker));
  return { transcribed, failed };
}

/**
 * How long a demo stays on the briefing after its start time.
 *
 * An hour, because the thing this is for is dialling five minutes late: the
 * brief must not vanish at the exact moment the demo begins. It is not a
 * worklist of everything anybody forgot to log — that was the first version,
 * at seven days, and it listed demos from Sunday as outstanding work on a
 * page somebody opens to read before a call they are about to make.
 */
const UNLOGGED_MINUTES = 60;

/**
 * Which demos the briefing covers.
 *
 * Everything still ahead, **plus anything whose time has passed that nobody
 * has said what happened to yet**. It shipped as `start_at > now()` alone and
 * that was wrong the first evening: a founder at 9pm found the 9pm demo gone
 * from the page before they had made the call — the one moment the briefing
 * is meant to be open.
 *
 * "Logged" is an attendance row marked at or after the booking, which is the
 * same test `needsRingBack` and `needsFollowUp` use in `lib/meetings.ts`.
 * Following the pipeline instead would be wrong for the reason documented
 * there: a prospect who turned up and declined is settled, and a lead sitting
 * at Lost covers both "no-showed twice" and "showed up and we failed".
 *
 * One fragment, used by the page and by the route that writes the briefs, so
 * a demo the page shows can always be briefed.
 */
export const briefScope = sql`
  m.status = 'accepted'
  and m.start_at > now() - make_interval(mins => ${UNLOGGED_MINUTES}::int)
  -- Gone the moment somebody says what happened, so a demo you have already
  -- dealt with does not sit there for the rest of the hour -- and one a founder
  -- wrote off before it began (2026-09-25) is never briefed at all.
  and not exists (
    select 1 from call_demo_attendance a
    where a.call_lead_id = m.call_lead_id
      and ${answersMeeting("a", "m")}
  )
`;

/**
 * The briefs already written for these meetings, keyed by meeting.
 *
 * One query for the whole Meetings list, which is what puts a brief under
 * every row without a lookup per row. Staleness is not worked out here: that
 * needs every meeting's transcript, and the fold asks the route to check the
 * one meeting somebody actually opens instead.
 */
export async function getStoredBriefs(
  meetingIds: number[],
): Promise<Map<number, StoredBrief>> {
  const out = new Map<number, StoredBrief>();
  if (meetingIds.length === 0) return out;
  const rows = (await db.execute(sql`
    select meeting_id, summary, generated_at
    from call_meeting_brief
    where meeting_id in (${sql.join(
      meetingIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)) as unknown as Record<string, unknown>[];
  for (const r of rows) {
    out.set(Number(r.meeting_id), {
      summary: String(r.summary),
      generatedAt: new Date(r.generated_at as string).toISOString(),
    });
  }
  return out;
}

/** One upcoming demo as the briefing document renders it. */
export type BriefedMeeting = {
  meetingId: number;
  company: string;
  attendeeName: string | null;
  phone: string | null;
  niche: string | null;
  startAt: string;
  leadTz: string | null;
  attendeeTz: string | null;
  bookedBy: string | null;
  bookedAt: string | null;
  notes: string | null;
  /** Null until somebody has pressed the button. */
  summary: string | null;
  generatedAt: string | null;
  /** True when the material has moved since the brief was written — another
   *  call logged, or the recording transcribed. The document says so rather
   *  than quietly showing a brief that predates the last conversation. */
  stale: boolean;
  /** Its time has passed and nobody has said what happened. The reason it is
   *  still on the page, so the page has to say so. */
  waiting: boolean;
};

/**
 * Every upcoming demo, with its brief where one has been written.
 *
 * Returns the meetings either way. A document that listed only the briefed
 * ones would answer "what is coming up" wrongly the first time somebody opened
 * it, which is the one moment it has to be trusted.
 */
export async function getBriefedMeetings(): Promise<BriefedMeeting[]> {
  const rows = (await db.execute(sql`
    select
      m.id as meeting_id,
      coalesce(l.company, m.attendee_name, 'Unlinked booking') as company,
      m.attendee_name, m.start_at, m.attendee_tz,
      coalesce(m.attendee_phone, l.phone) as phone,
      -- The prospect's own clock, from the same fragment every other calling
      -- screen uses. Never a second copy of those rules: a brief that names a
      -- different zone from the row it was generated off is two answers to
      -- one question.
      z.tz as lead_tz,
      cl.niche as niche,
      bu.name as booked_by,
      coalesce(
        bc.called_at,
        case when m.created_at < m.start_at then m.created_at end
      ) as booked_at,
      bc.notes as notes,
      b.summary, b.generated_at, b.source_fingerprint,
      (m.start_at <= now()) as waiting
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join "call" bc on bc.id = m.call_id
    left join app_user bu on bu.id = bc.user_id
    left join call_meeting_brief b on b.meeting_id = m.id
    ${leadZone}
    where ${briefScope}
    -- Diary order, which puts anything overdue at the top by itself: the
    -- demo nobody has logged started before the ones still to come.
    order by m.start_at asc
  `)) as unknown as Record<string, unknown>[];

  const ids = rows.map((r) => Number(r.meeting_id));
  // Recomputed rather than trusted, so "stale" means what it says: the
  // material now hashes differently from what the brief was written from.
  const sources = await briefSources(ids);

  return rows.map((r) => {
    const id = Number(r.meeting_id);
    const source = sources.get(id);
    const fp = (r.source_fingerprint as string | null) ?? null;
    return {
      meetingId: id,
      company: String(r.company),
      attendeeName: (r.attendee_name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      niche: (r.niche as string | null) ?? null,
      startAt: new Date(r.start_at as string).toISOString(),
      leadTz: (r.lead_tz as string | null) ?? null,
      attendeeTz: (r.attendee_tz as string | null) ?? null,
      bookedBy: (r.booked_by as string | null) ?? null,
      bookedAt: r.booked_at
        ? new Date(r.booked_at as string).toISOString()
        : null,
      notes: ((r.notes as string | null) ?? "").trim() || null,
      summary: (r.summary as string | null) ?? null,
      generatedAt: r.generated_at
        ? new Date(r.generated_at as string).toISOString()
        : null,
      stale: Boolean(r.summary) && (!source || !fp || fingerprint(source) !== fp),
      waiting: Boolean(r.waiting),
    };
  });
}

/**
 * What the model is asked for.
 *
 * Written as instructions to somebody about to walk into the demo, because
 * that is who reads it — the same instinct as the dial card's booking steps
 * and the SOP's "You say" lines. Every rule below is there to stop a specific
 * way a summary of a sales call goes wrong:
 *
 * - **Say "not said on the call"** rather than inferring. A brief that guesses
 *   the prospect's van count reads exactly like one that knows it, and the
 *   person reading it is about to repeat it back to them.
 * - **No advice.** The SOP already says what to do; a model improvising a
 *   pitch mid-brief would be a second, unreviewed script.
 * - **Every bullet quotes the call** (2026-10-02). Mission Based
 *   Construction's brief said the owner wanted a voice agent "in the future
 *   but not right now" when all she said was "I have thought about having
 *   something as such". A paraphrase reads exactly like a fact, so each bullet
 *   now carries the words behind it in quotation marks, and `verifiedBrief`
 *   drops any bullet whose quote is not actually in the transcript or notes.
 * - **Short.** This is read in the minute before a call, and fourteen of them
 *   are read in a row.
 */
const SYSTEM = [
  "You brief a salesperson in the minute before they take a booked demo.",
  "You are given the transcript of the cold call that won the meeting, plus any notes the caller typed and the outcomes of earlier calls to the same business.",
  "",
  "Our callers follow a fixed script, so do not retell the call. The script asks what time they close, what happens to calls after that (voicemail, someone answers, the owner answers, whether someone is paid to be on call), whether they have considered or seen a voice agent, then offers a demo and books a time. Report what THIS prospect said, never what the caller said or what the script says.",
  "",
  "Write short bullets, one line each, in this order. Each bullet is a short plain headline of 14 words or fewer that a busy reader takes in at a glance, written in short everyday words, then \" Details: \" and the evidence for anyone who wants to check. The evidence has this form: Asked: \"what our caller said\" Said: \"what the prospect answered\". Where the prospect raised it unprompted use Said: \"...\" alone. Each quoted piece is a full sentence or two (up to about 45 words) copied exactly from ONE speaker, never cut before a \"but\", a reason or a condition, with no fixed grammar, joined speakers or added words (use ... to skip words).",
  "",
  "The first four labelled lines are always written, with the label exactly as shown: Trial, Time, Decision maker, Warmth. The rest are written only when the call has something for them:",
  "- Trial: whether OUR CALLER suggested a trial (a free or 30 day trial, or to try it with no commitment). Always written, and the most important line. If the caller suggested one, the headline is \"Suggested by our caller.\" then Details with the caller's words and how the prospect reacted. If not, write exactly \"Not suggested.\" with no Details. If the prospect raised a trial first, say so in plain words (for example \"The prospect asked about a trial.\") with Details; that is not our caller suggesting one.",
  "- Time: ONLY how flexible the prospect is about the booked time, so the salesperson knows whether it is fine to ring an hour or two early. Do NOT state the day or time (it is shown elsewhere) and do NOT retell the back and forth. Write exactly one of: \"Fine to ring early.\" or \"Better not to ring early.\" or \"Not sure if ringing early is fine.\" Then, ONLY after \"Better not to ring early.\" or \"Not sure\", one short reason of 12 words or fewer, in plain words (for example: On a job site until 4:30.). Then write \" Details: \" and the evidence in Asked: \"...\" Said: \"...\" form, for the reader who wants to check. Choosing one of the options the caller offered, or saying yes to a time, is the NORMAL case and means \"Fine to ring early.\": it is not a sign of being particular. \"Better not to ring early.\" needs a real constraint in the call: a reason or a window (on a job site until 4:30, in a meeting, only free after a certain hour), pushing back on the times offered, or asking to move it. The short reason must NOT restate the time or the option they picked; say what the constraint is. If you cannot name a constraint, it is \"Fine to ring early.\" and the reason is left out. Judge from the whole exchange and read the ENTIRE transcript, including the end, before saying a time was not discussed. This line is the one exception to \"give no advice\". Only if no time was discussed anywhere, write exactly \"No time was discussed in this recording.\"",
  "- Decision maker: who decides whether to buy. Headline in plain words, for example \"The owner. Decides alone.\" or \"Not clear if they decide alone.\" Never assume the person on the call decides: if the call does not show it, write \"Not clear from the call.\" Add Details only when something was said.",
  "- Warmth: one plain word (keen, interested, lukewarm, polite only) and a reason in a few words, then Details. If nothing shows how they felt, write \"Not clear from the call.\"",
  "- After hours: ONE line on what happens to their calls once they are closed, as a short plain sentence (for example \"The owner picks up himself, even late.\"), then Details. Fold the closing time in only if it matters. Never write a separate Hours line.",
  "- Voice agent: what they think of a voice agent in plain words: \"Has not considered one.\", \"Has not heard of it.\", \"Already looked into it.\", \"Already uses one.\" or \"Open to it.\" Only write this line if it adds something the other lines do not. If the only evidence is a quote already used in another line, leave this line out.",
  "- About them: one or two lines, each a short plain observation that shows what kind of person they are, or something interesting or unusual they said. Look for: how they come across (blunt, jokey, rushed, chatty, careful, suspicious), their situation (new business, a one person crew, in the busy season), a bad or good past experience, a tool or competitor they use, a strong opinion, a person to ask for. Say what you notice in a few words, for example \"Blunt and very busy. Wants a call back.\" then Details with what they said. Only something specific and a little unusual, that a salesperson would not guess: skip generic traits such as friendly, polite, open, casual, flexible or busy, and skip anything the other lines already cover. Do not judge someone's personality from one word. If nothing specific stands out, leave this line out entirely.",
  "- Demo: how they reacted to being offered the demo, only if it was more than a plain yes (an objection or hesitation). Leave it out otherwise.",
  "- Promised: anything the caller promised or agreed to send or do. Leave it out if nothing was.",
  "- Gatekeeper: only when the person who agreed is not the owner or decision maker, or anything awkward worth knowing before dialling (annoyed, rushed, wrong person).",
  "",
  "Rules:",
  "- NEVER use the same quote in two lines. If two lines would share a quote, write one line. Do not write lines called Hours, Reach, Business or Also said.",
  "- A headline needs evidence that shows it. If you cannot back a line with a quote, leave it out. The only exceptions are the four always-written lines when the call truly shows nothing (their plain \"not suggested\" or \"not clear\" wording).",
  "- Never infer a fact that was not said.",
  "- Keep the prospect's tense. Something they considered or tried in the past is not a plan, a delay or a \"not right now\". Never write that they want something later, or not yet, unless they said so.",
  "- Read a short answer against the question that was asked. If the caller asks \"have you considered\", \"have you heard of\" or \"do you use\" a voice agent and the prospect says \"no\", that means they have not, it is NOT a refusal and NOT a lack of interest. Only write that they are not interested when they decline it after it was explained or offered, in words that say so.",
  "- Only lines marked Prospect are the prospect's words. Something our caller said or suggested is never the prospect's view.",
  "- Give no advice and no pitch, except the Time line, which says whether it is fine to ring early.",
  "- No preamble, no heading, no sign-off. Bullets only, starting with '- '.",
  "- Do not use em dashes.",
  "- If there is no transcript and no notes, reply with exactly: - No recording or notes from the booking call.",
].join("\n");

function userPrompt(s: BriefSource): string {
  const parts = [`Business: ${s.company}`];
  if (s.niche) parts.push(`Trade: ${s.niche}`);
  if (s.bookedBy) parts.push(`Booked by: ${s.bookedBy}`);
  if (s.history.length > 0) {
    parts.push(`Earlier call outcomes, oldest first: ${s.history.join(", ")}`);
  }
  if (s.notes) parts.push(`\nNotes the caller typed:\n${s.notes}`);
  parts.push(
    s.transcript
      ? `\nTranscript of the booking call${s.transcriptMinutes ? ` (${s.transcriptMinutes} min)` : ""}:\n${s.transcript}`
      : s.hasRecording
        ? "\nThe booking call was recorded but the recording could not be transcribed."
        : "\nThe booking call was not recorded.",
  );
  return parts.join("\n");
}

/**
 * Write one brief, or throw naming the vendor.
 *
 * No retry: the caller generates fourteen of these and reports which failed,
 * which is more useful than one of them silently taking three times as long.
 */
export async function writeBrief(
  source: BriefSource,
  /** Which OpenAI model writes it. The default is the one in use; the override
   *  exists to compare models on real calls (2026-10-04). */
  model: string = MODEL,
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OPENAI_API_KEY is configured on this server.");

  // Nothing to read is answered here rather than being sent to a model to be
  // answered at a cost of one request per empty meeting. The two empty cases
  // are different facts and must not share a sentence: "there is no
  // recording" sends somebody looking for a fault, and is wrong whenever the
  // recording is sitting there unread.
  if (!source.transcript && !source.notes) {
    return source.hasRecording
      ? "- The booking call was recorded but could not be transcribed. Open the recording on the meeting row to listen."
      : "- No recording of the booking call, and the caller left no notes.";
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // Low but not zero: at 0 the model repeats the transcript's own phrasing
      // back as if it were a summary.
      temperature: 0.2,
      // Room for the quotes every line carries, and up to thirteen lines.
      // Room for the fuller quotes (question and answer on every line).
      max_tokens: 2400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(source) },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  void recordAiUsage({
    feature: "brief",
    model,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  });
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned an empty brief.");
  return verifiedBrief(text, source);
}

/** Lower case, letters and digits only, single spaces: a quote is matched on
 *  its words, not on the punctuation or casing a transcript happened to use. */
export const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Keep only the bullets whose quotes are really in the material.
 *
 * The prompt asks for quotes; this is what makes them worth trusting. Each
 * speaker's lines are run together on their own as well as the whole
 * transcript, because a transcript splits one sentence across turns when the
 * other side says "Like," in the middle of it, and a faithful quote of that
 * sentence is in neither turn alone. A quote with "..." in it is checked
 * piece by piece. A bullet with no quote survives only when it says something
 * was not said on the call, which is the one thing a quote cannot back.
 *
 * Dropped rather than flagged: a bullet with a quote nobody said is the exact
 * failure this exists to stop, and showing it with a warning still puts the
 * words in front of somebody about to dial.
 */
export function verifiedBrief(text: string, source: BriefSource): string {
  const lines = (source.transcript ?? "").split("\n");
  const bySpeaker = (label: string) =>
    lines
      .filter((l) => l.startsWith(label))
      .map((l) => l.slice(label.length))
      .join(" ");
  const haystacks = [
    source.transcript ?? "",
    bySpeaker("Prospect: "),
    bySpeaker("Our caller: "),
    source.notes ?? "",
  ]
    .map(normalise)
    .filter(Boolean);
  const found = (quote: string) =>
    quote
      .split(/\.\.\.|…/)
      .map(normalise)
      .filter(Boolean)
      .every((piece) => haystacks.some((h) => ` ${h} `.includes(` ${piece} `)));
  // Who said it (2026-10-04). "Said:" is the prospect and "Asked:" is our
  // caller, and a model labelled the caller's pitch as the prospect's answer
  // (Toss Boss: "Voice agent: Has not considered one. Said: I was just looking
  // for fifteen minutes of your time..."). The quote was real, so the check above
  // passed it. This one makes the label true.
  const spoken = (label: string, quote: string) => {
    const hay = normalise(bySpeaker(label));
    return quote
      .split(/\.\.\.|…/)
      .map(normalise)
      .filter(Boolean)
      .every((piece) => ` ${hay} `.includes(` ${piece} `));
  };
  const attributed = (line: string) =>
    [...line.matchAll(/(Asked|Said):\s*["“]([^"“”]+)["”]/g)].every((m) =>
      spoken(m[1] === "Said" ? "Prospect: " : "Our caller: ", m[2]),
    );

  const bullets = text.split("\n").filter((l) => l.trim());
  const timeTalked =
    /\b(\d{1,2}(:\d{2})?\s*(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b/i.test(
      bySpeaker("Our caller: "),
    );
  // The four lines that are always written (2026-10-04): Trial first because it
  // is the one the founders most want to see, then Time, Decision maker, Warmth.
  const ALWAYS = /^\s*-?\s*(Trial|Time|Decision maker|Warmth):/i;
  const quotesOf = (t: string) => [...t.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1]);
  const evidenceOk = (t: string) => quotesOf(t).every(found) && attributed(t);
  const kept = bullets
    .map((line) => {
      // Evidence ("Details") that cannot be verified is cut from a line that is
      // always written, which keeps its headline; every other line needs its
      // evidence and is dropped without it (below).
      if (ALWAYS.test(line) && line.includes(" Details: ")) {
        const at = line.indexOf(" Details: ");
        if (!evidenceOk(line.slice(at))) line = line.slice(0, at);
      }
      // The model's "no time discussed" is trusted only when the caller's own
      // lines have no day or clock time in them (Roll N Load was written up "no
      // time came up" on a call that read the booking back).
      if (/^\s*-?\s*Time:\s*No time was discussed/i.test(line)) {
        return timeTalked ? "" : noTimeLine(source);
      }
      // "Trial: Suggested" only stands when the caller's own words mention a
      // trial; otherwise it is the model reading one into a pitch about a demo.
      if (/^\s*-?\s*Trial:\s*Suggested/i.test(line)) {
        const asked = [...line.matchAll(/Asked:\s*["“]([^"“”]+)["”]/g)].map((m) => m[1]).join(" ");
        if (!/\b(trial|free|try (it|this|us)|no cost|no charge|30[- ]day|thirty)\b/i.test(asked)) {
          return "- Trial: Not suggested.";
        }
      }
      return line;
    })
    .filter((line) => {
      if (line === "") return false;
      if (quotesOf(line).length === 0) {
        // Only the four always-written lines may stand with no evidence, and
        // only in their plain "nothing to report" or verdict-only wording.
        if (!ALWAYS.test(line)) return false;
        return /not clear from the call|not suggested|^\s*-?\s*Time:\s*(Not discussed in this recording|A time was discussed|Fine to ring early|Better not to ring early|Not sure if ringing early)|^\s*-?\s*(Decision maker|Warmth):/i.test(line);
      }
      return evidenceOk(line);
    });
  // Never the same quote under two labels (2026-10-04: one outburst was written
  // up under both After hours and Voice agent). The first line to use a quote
  // keeps it; a later line whose quotes are ALL already used is dropped.
  const used = new Set<string>();
  const unique = kept.filter((line) => {
    const qs = quotesOf(line).map(normalise);
    if (qs.length === 0) return true;
    const fresh = qs.filter((q) => !used.has(q));
    qs.forEach((q) => used.add(q));
    return fresh.length > 0 || ALWAYS.test(line);
  });
  if (unique.length < bullets.length) {
    console.warn(
      `[meeting-brief] dropped ${bullets.length - unique.length} unquoted, misquoted or repeated bullet(s) for meeting ${source.meetingId}`,
    );
  }
  if (unique.length === 0) {
    return "- Nothing on the call could be quoted for a brief. Open the recording on the meeting row to listen.";
  }
  // A missing always-written line reads as "nobody looked", where a plain
  // "not clear" says it was checked.
  const labelOf = (l: string) => /^\s*-?\s*(Trial|Time|Decision maker|Warmth):/i.exec(l)?.[1]?.toLowerCase();
  const fixed: Record<string, string> = {
    trial: "- Trial: Not suggested.",
    time: timeTalked
      ? "- Time: A time was discussed on the call but could not be summarised. Listen to the recording."
      : noTimeLine(source),
    "decision maker": "- Decision maker: Not clear from the call.",
    warmth: "- Warmth: Not clear from the call.",
  };
  const head = (["trial", "time", "decision maker", "warmth"] as const).map(
    (k) => unique.find((l) => labelOf(l) === k) ?? fixed[k],
  );
  return [...head, ...unique.filter((l) => !labelOf(l))].join("\n");
}
