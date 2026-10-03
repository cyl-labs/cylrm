/**
 * A written review of a demo call, scored against the mentor's NEPQ and
 * Challenger checklist (2026-10-03).
 *
 * Asked for so the founders, and the closers who will start taking meetings,
 * can see what a demo did well, what it missed and what to change, against one
 * agreed yardstick (`demo-review-rubric.ts`) rather than somebody's memory of
 * it. Same shape as `meeting-brief.ts`: plain `fetch` to OpenAI on the same
 * model, a stored result, and a fingerprint so reopening costs nothing.
 *
 * Two rules keep it honest:
 * - **Every rating is backed by a quote** that is checked against the
 *   transcript. A "done" whose quote is not really there is downgraded to
 *   "partly", and the quote is dropped.
 * - **The talk split is counted here**, from who spoke, never estimated by the
 *   model.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { recordAiUsage } from "@/lib/ai-usage";
import { clusterDemoRecordings, DEMO_RECORDING_WHERE } from "@/lib/meetings";
import { normalise } from "@/lib/meeting-brief";
import { briefSources } from "@/lib/meeting-brief";
import {
  BOOKING_RUBRIC_TEXT,
  BOOKING_STAGES,
  REVIEW_STAGES,
  RUBRIC_TEXT,
} from "@/lib/demo-review-rubric";
import type { TranscriptTurn } from "@/db/schema";
import type {
  DemoReview,
  ReviewStage,
  StageRating,
  StoredReview,
} from "@/lib/demo-review-types";

const API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 90_000;
/** Less than this is a dropped call, not a demo worth scoring. */
export const REVIEW_MIN_MINUTES = 3;
/** The opening and the close are where the method shows, so a very long call
 *  loses its middle rather than its ends. */
const HEAD_CHARS = 26_000;
const TAIL_CHARS = 12_000;

export const reviewConfigured = () => Boolean(process.env.OPENAI_API_KEY);

export type ReviewSource = {
  meetingId: number;
  company: string;
  niche: string | null;
  /** Every recording in the demo cluster, in the order they happened. */
  recordingIds: string[];
  /** Recordings in the cluster that still have no transcript. */
  untranscribedIds: string[];
  minutes: number;
  transcript: string | null;
  talk: DemoReview["talk"] | null;
};

/**
 * The demo's recordings (a redial keeps both halves), transcribed or not.
 *
 * `onlyIds` is the reviewer's own choice of which calls to analyse
 * (2026-10-03): the automatic pick is a guess, a demo that drops is several
 * recordings, and a voicemail can be mistaken for the demo. Chosen ids are only
 * honoured when the call was to or from this business's number, so a crafted
 * request cannot pull in somebody else's recording.
 */
export async function reviewSource(
  meetingId: number,
  onlyIds?: string[],
): Promise<ReviewSource | null> {
  const meta = (await db.execute(sql`
    select coalesce(l.company, m.attendee_name, 'Unlinked booking') as company,
           cl.niche as niche
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    where m.id = ${meetingId}
  `)) as unknown as Record<string, unknown>[];
  if (meta.length === 0) return null;

  const chosen = onlyIds && onlyIds.length > 0 ? onlyIds : null;
  const rows = (await db.execute(
    chosen
      ? sql`
    select cr.recording_id, cr.duration_ms, cr.started_at,
           cr.transcript_turns as turns, cr.transcript_text as text
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    join call_recording cr
      on cr.recording_id in (${sql.join(chosen.map((id) => sql`${id}`), sql`, `)})
     and (
       cr.to_number in ('+' || l.phone_key, '+' || l.direct_phone_key, m.attendee_phone)
       or cr.from_number in ('+' || l.phone_key, '+' || l.direct_phone_key, m.attendee_phone)
     )
    where m.id = ${meetingId}
    order by cr.started_at asc, cr.id asc
  `
      : sql`
    select cr.recording_id, cr.duration_ms, cr.started_at,
           cr.transcript_turns as turns, cr.transcript_text as text
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    join call_recording cr on ${DEMO_RECORDING_WHERE}
    where m.id = ${meetingId}
    order by cr.started_at asc, cr.id asc
  `,
  )) as unknown as Record<string, unknown>[];

  const all = rows.map((r) => ({
    recordingId: String(r.recording_id),
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    startedAt: new Date(r.started_at as string).toISOString(),
    turns: Array.isArray(r.turns) ? (r.turns as TranscriptTurn[]) : null,
    text: (r.text as string | null) ?? null,
  }));
  // The reviewer's choice is taken as given. Only the automatic pick is
  // clustered (the group holding the longest call).
  const clustered = chosen ? all : clusterDemoRecordings(all);

  const minutes =
    Math.round((clustered.reduce((a, r) => a + (r.durationMs ?? 0), 0) / 60_000) * 10) / 10;
  const untranscribedIds = clustered
    .filter((r) => !r.text && !(r.turns && r.turns.length > 0))
    .map((r) => r.recordingId);

  const words = { closer: 0, all: 0 };
  let questions = 0;
  const parts: string[] = [];
  for (const r of clustered) {
    if (r.turns && r.turns.length > 0) {
      parts.push(
        r.turns
          .map((t) => `${t.speaker === "caller" ? "Closer" : "Prospect"}: ${t.text}`)
          .join("\n"),
      );
      for (const t of r.turns) {
        const n = t.text.split(/\s+/).filter(Boolean).length;
        words.all += n;
        if (t.speaker === "caller") {
          words.closer += n;
          questions += (t.text.match(/\?/g) ?? []).length;
        }
      }
    } else if (r.text) {
      parts.push(r.text);
    }
  }
  let transcript = parts.length > 0 ? parts.join("\n--- the call dropped and was redialled ---\n") : null;
  if (transcript && transcript.length > HEAD_CHARS + TAIL_CHARS) {
    transcript =
      transcript.slice(0, HEAD_CHARS) +
      "\n…(middle of the call trimmed)…\n" +
      transcript.slice(-TAIL_CHARS);
  }

  return {
    meetingId,
    company: String(meta[0].company),
    niche: (meta[0].niche as string | null) ?? null,
    recordingIds: clustered.map((r) => r.recordingId),
    untranscribedIds,
    minutes,
    transcript,
    talk:
      words.all > 0
        ? {
            closerPercent: Math.round((words.closer / words.all) * 100),
            closerQuestions: questions,
            minutes,
          }
        : null,
  };
}

/** Which call is being reviewed: the demo a founder or closer runs, or the cold
 *  call a caller made to book it. Each has its own table, steps and prompt. */
export type ReviewKind = "demo" | "booking";

const TABLE = { demo: sql.raw("call_meeting_review"), booking: sql.raw("call_booking_review") };

export function reviewFingerprint(s: ReviewSource, kind: ReviewKind = "demo"): string {
  return createHash("sha256")
    .update(JSON.stringify([SYSTEMS[kind], s.company, s.transcript ?? ""]))
    .digest("hex")
    .slice(0, 32);
}

export async function getStoredReviews(
  meetingIds: number[],
  kind: ReviewKind = "demo",
): Promise<Map<number, StoredReview>> {
  const out = new Map<number, StoredReview>();
  if (meetingIds.length === 0) return out;
  const rows = (await db.execute(sql`
    select meeting_id, review, generated_at
    from ${TABLE[kind]}
    where meeting_id in (${sql.join(
      meetingIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)) as unknown as Record<string, unknown>[];
  for (const r of rows) {
    out.set(Number(r.meeting_id), {
      review: r.review as DemoReview,
      generatedAt: new Date(r.generated_at as string).toISOString(),
    });
  }
  return out;
}

function buildSystem(kind: ReviewKind): string {
  const stages = kind === "demo" ? REVIEW_STAGES : BOOKING_STAGES;
  return [
  ...(kind === "booking"
    ? [
        "You review a recorded cold call and give the caller honest, specific feedback, scored against the reference below.",
        "The caller phones small service businesses to book a demo of an AI phone receptionist. The call may be short. In the transcript, 'Our caller' is our side and 'Prospect' is whoever answered. Many cold calls never get far: a voicemail, a quick hang up, a wrong person. Do not mark steps missed that the call never reached; use not_reached.",
      ]
    : [
  "You review a recorded sales demo call and give the closer honest, specific feedback, scored against the reference method below.",
  "The closer sells an AI phone receptionist to a small service business. The call is a founder or closer talking to the business owner. Part of it is a demo: the closer may add the AI receptionist to the line and play a pretend customer while the owner listens. Treat that stretch as the presentation and do not mark the closer down for not asking questions during it; it may look garbled in the transcript. This is the second call with the owner: the caller who booked it only asked a few script questions, so the closer is still expected to find out what matters to this owner, but a demo is not held to the rule that 80% of the call is questions.",
  "In the transcript, 'Closer' is our side and 'Prospect' is the business owner.",
    ]),
  "",
  kind === "demo" ? RUBRIC_TEXT : BOOKING_RUBRIC_TEXT,
  "",
  `Score each of these ${stages.length} steps, using these exact keys:`,
  ...stages.map((s) => `- ${s.key} (${s.method}): ${s.means}`),
  "",
  "Ratings: done (clearly did it), partly (tried or half did it, or did it in a telling way instead of getting the prospect to say it), missed (the call reached the point where it belonged and the closer did not do it), not_reached (the call never got that far, for example it ended early).",
  "",
  "Reply with one JSON object and nothing else, in exactly this shape:",
  '{"headline": string, "stages": [{"key": string, "rating": "done"|"partly"|"missed"|"not_reached", "evidence": string|null, "note": string}], "wentWell": [string], "toImprove": [{"what": string, "tryThis": string}], "objections": [{"theySaid": string, "handled": string, "tryThis": string}], "biggestFix": string}',
  "",
  "Rules:",
  "- headline: one plain sentence summing up how the call went against the method.",
  "- stages: all the keys above, in the order given. note is one short plain sentence saying what happened, in everyday words. evidence is an exact quote of up to about 25 words copied character for character from ONE speaker in the transcript that backs the rating, or null when there is nothing to quote (a missed or not_reached step usually has none). Never write evidence that is not in the transcript.",
  "- wentWell: 2 to 4 specific things the closer did well, each naming the moment. Leave the list shorter rather than flatter. Empty is allowed.",
  "- toImprove: 2 to 4 specific changes, most important first. what says the gap and where it happened. tryThis is a short line the closer could actually say next time, in the style of the reference (a question, not a statement, where the method calls for one). Never invent facts about the prospect that were not said.",
  "- objections: one entry for each real objection or hesitation the prospect raised (price, need to think, need to ask someone, already have something, not now). theySaid is a short quote of it, handled says in one sentence what the closer did, tryThis is how the reference would handle it. Empty list if there were none.",
  "- biggestFix: the single most valuable thing to change, in one or two plain sentences.",
  "- Be fair and specific. Do not praise a step that was not done, and do not mark a step missed when it was done in different words. Judge the method, not the outcome: a sale that was lost can still be a well run call.",
  "- Plain everyday language. No sales jargon without explaining it. Never use an em dash.",
].join("\n");
}

const SYSTEMS: Record<ReviewKind, string> = {
  demo: buildSystem("demo"),
  booking: buildSystem("booking"),
};

function userPrompt(s: ReviewSource, kind: ReviewKind): string {
  const parts = [`Business: ${s.company}`];
  if (s.niche) parts.push(`Trade: ${s.niche}`);
  parts.push(`Length: about ${s.minutes} minutes`);
  parts.push(`\nTranscript of the ${kind === "demo" ? "demo" : "booking"} call:\n${s.transcript}`);
  return parts.join("\n");
}

const RATINGS: StageRating[] = ["done", "partly", "missed", "not_reached"];
const clean = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s*—\s*/g, ", ").trim() : "";
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Write one review, or throw naming the vendor. */
export async function writeReview(
  s: ReviewSource,
  kind: ReviewKind = "demo",
): Promise<DemoReview> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OPENAI_API_KEY is configured on this server.");
  if (!s.transcript || !s.talk) throw new Error("There is no transcript to review.");

  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 3200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEMS[kind] },
        { role: "user", content: userPrompt(s, kind) },
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
    feature: "review",
    model: MODEL,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  });
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned an empty review.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned a review that could not be read.");
  }

  const hay = normalise(s.transcript);
  const inCall = (q: string) => {
    const pieces = q.split(/\.\.\.|…/).map(normalise).filter(Boolean);
    return pieces.length > 0 && pieces.every((p) => ` ${hay} `.includes(` ${p} `));
  };

  const byKey = new Map(
    list(raw.stages).map((x) => [String((x as { key?: unknown }).key), x as Record<string, unknown>]),
  );
  const stages: ReviewStage[] = (kind === "demo" ? REVIEW_STAGES : BOOKING_STAGES).map((def) => {
    const got = byKey.get(def.key);
    let rating = RATINGS.includes(got?.rating as StageRating)
      ? (got?.rating as StageRating)
      : "not_reached";
    let evidence = clean(got?.evidence) || null;
    if (evidence && !inCall(evidence)) evidence = null;
    // A "done" nobody can point to is not done.
    if (rating === "done" && !evidence) rating = "partly";
    return {
      key: def.key,
      label: def.label,
      method: def.method,
      rating,
      evidence,
      note: clean(got?.note),
    };
  });

  return {
    headline: clean(raw.headline),
    stages,
    wentWell: list(raw.wentWell).map(clean).filter(Boolean).slice(0, 4),
    toImprove: list(raw.toImprove)
      .map((x) => ({
        what: clean((x as { what?: unknown }).what),
        tryThis: clean((x as { tryThis?: unknown }).tryThis),
      }))
      .filter((x) => x.what)
      .slice(0, 4),
    objections: list(raw.objections)
      .map((x) => ({
        theySaid: clean((x as { theySaid?: unknown }).theySaid),
        handled: clean((x as { handled?: unknown }).handled),
        tryThis: clean((x as { tryThis?: unknown }).tryThis),
      }))
      .filter((x) => x.theySaid)
      .slice(0, 6),
    biggestFix: clean(raw.biggestFix),
    talk: s.talk,
    recordingIds: s.recordingIds.length > 0 ? s.recordingIds : undefined,
  };
}

/**
 * The booking call (the cold call that won the meeting) as a review source.
 * Read through `briefSources`, so it is the same conversation the briefing
 * reads, including the redial rule. Talk figures are counted from the
 * transcript lines ("Our caller:" is ours).
 */
export async function bookingSource(meetingId: number): Promise<{
  source: ReviewSource;
  hasRecording: boolean;
} | null> {
  const got = (await briefSources([meetingId])).get(meetingId);
  if (!got) return null;
  let closerWords = 0;
  let allWords = 0;
  let questions = 0;
  for (const line of (got.transcript ?? "").split("\n")) {
    const mine = line.startsWith("Our caller: ");
    if (!mine && !line.startsWith("Prospect: ")) continue;
    const text = line.slice(mine ? 12 : 10);
    const w = text.split(/\s+/).filter(Boolean).length;
    allWords += w;
    if (mine) {
      closerWords += w;
      questions += (text.match(/\?/g) ?? []).length;
    }
  }
  const minutes = got.transcriptMinutes ?? 0;
  return {
    hasRecording: got.hasRecording,
    source: {
      meetingId,
      company: got.company,
      niche: got.niche,
      recordingIds: [],
      untranscribedIds: [],
      minutes,
      transcript: got.transcript,
      talk:
        allWords > 0
          ? {
              closerPercent: Math.round((closerWords / allWords) * 100),
              closerQuestions: questions,
              minutes,
            }
          : null,
    },
  };
}

/** Which of these meetings did this user book (their call won it). */
export async function bookedBy(meetingIds: number[], userId: number): Promise<number[]> {
  if (meetingIds.length === 0) return [];
  const rows = (await db.execute(sql`
    select m.id from call_meeting m
    join "call" c on c.id = m.call_id
    where c.user_id = ${userId}
      and m.id in (${sql.join(meetingIds.map((id) => sql`${id}`), sql`, `)})
  `)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}
