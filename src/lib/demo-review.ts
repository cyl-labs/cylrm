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
// `gpt-4.1` since 2026-10-04 (was `gpt-4.1-mini`). Compared on 7 real calls with
// the same prompt: the same speed (about 2.8 s against 2.7 s) but far better at
// following the written rules, and about five times the price, which is still
// cents a month. The live objection hints stay on the mini, where speed matters.
export const REVIEW_MODEL = "gpt-4.1";
const MODEL = REVIEW_MODEL;
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
  `{"headline": string, "nextSteps": [{"when": string, "do": string, "say": string}], "stages": [{"key": string, "rating": "done"|"partly"|"missed"|"not_reached", "evidence": string|null, "note": string}], "wentWell": [string], "objections": [{"theySaid": string, "handled": string, "tryThis": string}]${kind === "demo" ? ', "ownerMoments": [{"quote": string, "feeling": string, "closerNext": string}]' : ""}}`,
  "",
  "Rules:",
  "- READING LEVEL: write everything the reader sees at a third grade reading level. Use short everyday words. Keep sentences under 12 words, one idea each. Never use sales words such as discovery, qualify, consequence, reframe, transition, objection, rapport, insight, framework, leverage, value proposition, or pain point. Say what to do, not what to explore. Say owner, not prospect.",
  "- headline: one plain sentence on how the call went.",
  "- nextSteps: 1 to 3 steps for the NEXT call, most important first, chosen because they would change the result the most. Never repeat the same lesson twice. If the call went well, give one step that would make it better. Each step has: when, do and say. when points at the moment in THIS call. Start with what the owner said and put a few of their exact words in double quotes, for example: When the owner said \"many people do not like talking to a machine\". do is one thing to do, starting with a verb, in plain words. say is the exact words to say, one or two short sentences, a question where the method calls for one. Never make up facts about the owner.",
  "- stages: all the keys above, in the order given. note is one short plain sentence saying what happened. evidence is an exact quote of up to about 25 words copied character for character from ONE speaker in the transcript. Every done, partly and missed step needs one: for done and partly it is the line that shows what was done; for missed it is the line where the step should have happened (for example the caller offering times before any time zone was asked). Use null only for not_reached. The quote must prove the note, so never quote an unrelated line (an email address does not prove a time was read back). Never write evidence that is not in the transcript. The note must agree with the rating and with the quote: do not write a note that says the step was done fully when the rating is partly.",
  "- wentWell: 2 to 4 specific things done well, each naming the moment. Leave the list shorter rather than flatter. Empty is allowed.",
  "- objections: one entry for each time the owner pushed back or hesitated (price, need to think, need to ask someone, already have something, not now). theySaid is a short exact quote of it, picked so it reads clearly: speech to text garbles money (for example '90 $9' for $99), so choose a clearer line from the same push back instead of showing a garbled number, handled says in one sentence what was done, tryThis is what to say instead, in plain words. Empty list if there were none.",
  ...(kind === "demo"
    ? [
        "- ownerMoments: 0 to 6 lines where the OWNER (the Prospect) showed a strong feeling or changed course. This is about the owner, not about how the closer did, so do not score anything here. Look for: refusing something, saying the same complaint again, a personal stake (years in the trade, a time they need to be somewhere), blaming or doubting the closer, saying the call is a waste of their time, and a sudden spark of interest. Pick the lines that are unusual and tell us the most. Skip polite filler and plain facts. quote is an exact quote of up to about 25 words copied character for character from the Prospect's lines only, never from the Closer. feeling is one short plain sentence on what the owner felt. closerNext is one short plain sentence on what the closer did right after. Put them in the order they happened. Empty list if the owner showed nothing strong.",
      ]
    : []),
  "- Be fair and specific. Do not praise a step that was not done, and do not mark a step missed when it was done in different words. Judge the method, not the outcome: a sale that was lost can still be a well run call.",
  "- Never use an em dash.",
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
      max_tokens: 3800,
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

  // The owner's own lines only: a quote of the closer is not an owner moment.
  const ownerHay = normalise(
    s.transcript
      .split("\n")
      .filter((l) => l.startsWith("Prospect: "))
      .map((l) => l.slice(10))
      .join(" "),
  );
  const ownerSaid = (q: string) => {
    // Without speaker labels (an old text-only transcript) fall back to the whole call.
    if (!ownerHay) return inCall(q);
    const pieces = q.split(/\.\.\.|…/).map(normalise).filter(Boolean);
    return pieces.length > 0 && pieces.every((p) => ` ${ownerHay} `.includes(` ${p} `));
  };
  const ownerMoments =
    kind === "demo"
      ? list(raw.ownerMoments)
          .map((x) => {
            const o = x as { quote?: unknown; feeling?: unknown; closerNext?: unknown };
            return {
              quote: clean(o.quote),
              feeling: clean(o.feeling),
              closerNext: clean(o.closerNext),
            };
          })
          .filter((x) => x.quote && x.feeling && ownerSaid(x.quote))
          .slice(0, 6)
      : [];

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

  // The moment each step points at. Quoted words that are not really in the
  // call are cut out rather than shown, the same rule the evidence follows.
  const nextSteps = list(raw.nextSteps)
    .map((x) => {
      const o = x as { when?: unknown; do?: unknown; say?: unknown };
      const when = clean(o.when).replace(/["“]([^"“”]+)["”]/g, (all, q: string) =>
        inCall(q) ? all : "",
      );
      let tidy = when.replace(/\s+/g, " ").trim();
      // A pointer whose quote was cut ends mid-sentence ("When the owner said"),
      // which is worse than no pointer.
      tidy = tidy.replace(/\s+([.,;:])/g, "$1");
      if (/\b(said|asked|told you|answered)[\s:,.]*$/i.test(tidy) || tidy.length < 12) tidy = "";
      return { when: tidy, do: clean(o.do), say: clean(o.say) };
    })
    .filter((x) => x.do && x.say)
    .slice(0, 3);

  return {
    headline: clean(raw.headline),
    stages,
    wentWell: list(raw.wentWell).map(clean).filter(Boolean).slice(0, 4),
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    // Kept for reviews written before nextSteps; new ones leave it empty.
    toImprove: [],
    objections: list(raw.objections)
      .map((x) => ({
        theySaid: clean((x as { theySaid?: unknown }).theySaid),
        handled: clean((x as { handled?: unknown }).handled),
        tryThis: clean((x as { tryThis?: unknown }).tryThis),
      }))
      .filter((x) => x.theySaid)
      .slice(0, 6),
    biggestFix: nextSteps[0]?.do ?? "",
    ownerMoments: ownerMoments.length > 0 ? ownerMoments : undefined,
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
