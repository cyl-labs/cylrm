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
import { leadZone } from "@/lib/calls";
import { transcribeUrl, transcriptionConfigured } from "@/lib/deepgram";
import { recordingDownloadUrl } from "@/lib/telnyx";
import type { TranscriptTurn } from "@/db/schema";

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
const MODEL = "gpt-4.1-mini";

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
        s.company,
        s.niche,
        s.notes ?? "",
        s.transcript ?? "",
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
      m.call_lead_id as lead_id
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join "call" bc on bc.id = m.call_id
    left join app_user bu on bu.id = bc.user_id
    left join call_recording cr on cr.call_session_id = bc.telnyx_session_id
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
        ? turns.map((t) => `${t.speaker}: ${t.text}`).join("\n")
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
    join call_recording cr on cr.call_session_id = bc.telnyx_session_id
    where m.id in (${sql.join(
      meetingIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      and cr.transcript_text is null
  `)) as unknown as Record<string, unknown>[];

  const ids = rows.map((r) => String(r.recording_id));
  if (ids.length === 0) return { transcribed: 0, failed: 0 };

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
      b.summary, b.generated_at, b.source_fingerprint
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    left join "call" bc on bc.id = m.call_id
    left join app_user bu on bu.id = bc.user_id
    left join call_meeting_brief b on b.meeting_id = m.id
    ${leadZone}
    where m.status = 'accepted' and m.start_at > now()
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
 * - **Quote the prospect** for anything that sounds like a commitment. "He
 *   said he'd want it answering evenings" is checkable; "they need evening
 *   cover" is the model's paraphrase presented as their words.
 * - **Short.** This is read in the minute before a call, and fourteen of them
 *   are read in a row.
 */
const SYSTEM = [
  "You brief a salesperson in the minute before they take a booked demo.",
  "You are given the transcript of the cold call that won the meeting, plus any notes the caller typed and the outcomes of earlier calls to the same business.",
  "",
  "Write at most 5 short bullets, each one line. Cover only what is actually there:",
  "- What the business does and its size, if said.",
  "- The problem they described — missed calls, when, what it costs them.",
  "- Anything they objected to or hesitated over.",
  "- Anything the caller promised or agreed.",
  "- Anything awkward worth knowing before dialling (annoyed, rushed, wrong person, asked not to be called at a certain time).",
  "",
  "Rules:",
  '- Never infer a fact that was not said. If the call does not say what they do, write "not said on the call".',
  "- Quote the prospect in their own words for anything that sounds like a commitment or a number.",
  "- Give no advice and no pitch. Do not suggest what to say.",
  "- No preamble, no heading, no sign-off. Bullets only, starting with '- '.",
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
export async function writeBrief(source: BriefSource): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OPENAI_API_KEY is configured on this server.");

  // Nothing to read is answered here rather than being sent to a model to be
  // answered at a cost of one request per empty meeting. The two empty cases
  // are different facts and must not share a sentence: "there is no
  // recording" sends somebody looking for a fault, and is wrong whenever the
  // recording is sitting there unread.
  if (!source.transcript && !source.notes) {
    return source.hasRecording
      ? "- The booking call was recorded but could not be transcribed — open the recording on the meeting row to listen."
      : "- No recording of the booking call, and the caller left no notes.";
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // Low but not zero: at 0 the model repeats the transcript's own phrasing
      // back as if it were a summary.
      temperature: 0.2,
      max_tokens: 320,
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
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned an empty brief.");
  return text;
}
