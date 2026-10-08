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
  DEMO_SOP_TEXT,
  BOOKING_RUBRIC_TEXT,
  BOOKING_STAGES,
  FOLLOWUP_RUBRIC_TEXT,
  FOLLOWUP_STAGES,
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
  /** A follow-up call after the demo is scored on its own steps (2026-10-06). */
  meetingKind?: "demo" | "follow_up";
  company: string;
  niche: string | null;
  /** Every recording in the demo cluster, in the order they happened. */
  recordingIds: string[];
  /** Recordings in the cluster that still have no transcript. */
  untranscribedIds: string[];
  minutes: number;
  transcript: string | null;
  talk: DemoReview["talk"] | null;
  /** Every question the closer asked, in order, so "the closer never asked
   *  X" can be checked against all of them rather than the lines near the
   *  moment (2026-10-07). Empty for a transcript with no speaker labels. */
  closerQuestions?: string[];
};

/**
 * Which of our side's turns are the live agent demo (2026-10-07).
 *
 * The agent joins the closer's own channel, so its greeting, its questions and
 * the closer playing the pretend customer all arrive as "Closer" lines. That
 * put ten of Irvin's 46 "closer questions" on the agent and let the review
 * quote the agent's greeting as something the closer said. The stretch runs
 * from the agent's greeting to its sign off ("anything else I can help you
 * with") plus the short "Nope, thank you" after it. Both ends have to be found
 * and it must be under eight minutes, or nothing is marked: hiding the real
 * call is worse than counting the agent as the closer.
 */
export function demoStretch(turns: TranscriptTurn[]): Set<number> {
  const marked = new Set<number>();
  const start = turns.findIndex(
    (t) =>
      t.speaker === "caller" &&
      /(are you looking to get a (quote|booking)|thank you for calling|thanks for calling|you'?ve reached|you have reached)/i.test(
        t.text,
      ),
  );
  if (start < 0) return marked;
  let end = -1;
  for (let i = start; i < turns.length; i += 1) {
    if (
      turns[i].speaker === "caller" &&
      /(anything else i can help|is there anything else|have a (great|good|wonderful) day)/i.test(turns[i].text)
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || turns[end].start - turns[start].start > 8 * 60) return marked;
  // The pretend customer's "Nope. Thank you." after the sign off.
  while (
    end + 1 < turns.length &&
    turns[end + 1].speaker === "caller" &&
    turns[end + 1].text.split(/\s+/).length <= 6
  ) {
    end += 1;
  }
  for (let i = start; i <= end; i += 1) {
    if (turns[i].speaker === "caller") marked.add(i);
  }
  return marked;
}

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
           cl.niche as niche, m.kind as meeting_kind
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
  const closerQuestions: string[] = [];
  const parts: string[] = [];
  for (const r of clustered) {
    if (r.turns && r.turns.length > 0) {
      const demo = demoStretch(r.turns);
      parts.push(
        r.turns
          .map((t, i) =>
            t.speaker === "caller"
              ? `${demo.has(i) ? "Demo" : "Closer"}: ${t.text}`
              : `Prospect: ${t.text}`,
          )
          .join("\n"),
      );
      r.turns.forEach((t, i) => {
        const n = t.text.split(/\s+/).filter(Boolean).length;
        words.all += n;
        // The agent demo is the presentation, not the closer talking.
        if (t.speaker === "caller" && !demo.has(i)) {
          words.closer += n;
          questions += (t.text.match(/\?/g) ?? []).length;
          for (const sentence of t.text.match(/[^.?!]*\?/g) ?? []) {
            const q = sentence.replace(/^[\s,]+/, "").trim();
            if (q.length > 6) closerQuestions.push(q.slice(0, 200));
          }
        }
      });
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
    meetingKind: meta[0].meeting_kind === "follow_up" ? "follow_up" : "demo",
    recordingIds: clustered.map((r) => r.recordingId),
    untranscribedIds,
    minutes,
    transcript,
    closerQuestions,
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
/** Which yardstick: the demo's, the follow-up call's, or the cold call's. */
type Variant = "demo" | "followup" | "booking";
const variantOf = (s: { meetingKind?: string }, kind: ReviewKind): Variant =>
  kind === "booking" ? "booking" : s.meetingKind === "follow_up" ? "followup" : "demo";

const TABLE = { demo: sql.raw("call_meeting_review"), booking: sql.raw("call_booking_review") };

export function reviewFingerprint(s: ReviewSource, kind: ReviewKind = "demo"): string {
  return createHash("sha256")
    .update(JSON.stringify([SYSTEMS[variantOf(s, kind)], s.company, s.transcript ?? ""]))
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

function buildSystem(variant: Variant): string {
  const kind: ReviewKind = variant === "booking" ? "booking" : "demo";
  const stages =
    variant === "followup" ? FOLLOWUP_STAGES : variant === "demo" ? REVIEW_STAGES : BOOKING_STAGES;
  return [
  ...(variant === "followup"
    ? [
        "You review a recorded follow-up call after a demo and give the closer honest, specific feedback, scored against the reference below.",
        "The closer sells an AI phone receptionist to a small service business. The owner has already seen the demo and agreed to try it, usually a free trial. This call walks through the agreement, gets it signed and sets the trial up. In the transcript, 'Closer' is our side and 'Prospect' is the business owner. Do not score it like a first demo: do not mark the closer down for not asking about the cost of the problem.",
        "A slip by the closer counts as a moment too. If the closer says something that weakens trust (complaining about our own tools or bugs, saying they are in another country, promising something they cannot keep), put it in moments with the owner's line before it, rate it weak, and use it as the evidence for the 'credible' step, with closerLine set to the slip itself. In text you write yourself, fix obvious speech to text mistakes (for example 'scanned' when the owner said 'scammed'); quotes stay exact.",
      ]
    : [])
  ,
  ...(variant === "booking"
    ? [
        "You review a recorded cold call and give the caller honest, specific feedback, scored against the reference below.",
        "The caller phones small service businesses to book a demo of an AI phone receptionist. The call may be short. In the transcript, 'Our caller' is our side and 'Prospect' is whoever answered. Many cold calls never get far: a voicemail, a quick hang up, a wrong person. Do not mark steps missed that the call never reached; use not_reached.",
      ]
    : variant === "followup" ? [] : [
  "You review a recorded sales demo call and give the closer honest, specific feedback, scored against the reference method below.",
  "The closer sells an AI phone receptionist to a small service business. The call is a founder or closer talking to the business owner. Part of it is a demo: the closer may add the AI receptionist to the line and play a pretend customer while the owner listens. Treat that stretch as the presentation and do not mark the closer down for not asking questions during it; it may look garbled in the transcript. This is the second call with the owner: the caller who booked it only asked a few script questions, so the closer is still expected to find out what matters to this owner, but a demo is not held to the rule that 80% of the call is questions. THIS IS THE DEMO CALL THE OWNER ALREADY AGREED TO. They know the closer will add the AI receptionist to the line and that they should just listen. Showing a generic sample first, before asking the owner anything, is how these calls are meant to run. Never mark the closer down for starting with the sample, for not asking questions or summing up before it, or because the sample was not made from the owner's words. Judge those steps on what comes after the sample: the questions, and then the package and price.",
  "In the transcript, 'Closer' is our side and 'Prospect' is the business owner. Lines starting 'Demo' are the live AI receptionist demo, with the closer playing a pretend customer. They are neither the closer's own selling words nor the owner's. Never quote a Demo line as evidence, and never count it for or against the closer.",
    ]),
  "",
  ...(variant === "demo" ? [DEMO_SOP_TEXT, ""] : []),
  variant === "followup" ? FOLLOWUP_RUBRIC_TEXT : variant === "demo" ? RUBRIC_TEXT : BOOKING_RUBRIC_TEXT,
  "",
  `Score each of these ${stages.length} steps, using these exact keys:`,
  ...stages.map((s) => `- ${s.key} (${s.method}): ${s.means}`),
  "",
  "Ratings: done (clearly did it), partly (tried or half did it, or did it in a telling way instead of getting the prospect to say it), missed (the call reached the point where it belonged and the closer did not do it), not_reached (the call never got that far, for example it ended early).",
  "",
  "Reply with one JSON object and nothing else, in exactly this shape:",
  `{"moments": [{"ownerSaid": string, "closerReplied": string, "howItWent": "strong"|"weak"|"none", "gap": string}], "headline": string, "nextSteps": [{"moment": number, "when": string, "do": string, "say": string}], "stages": [{"key": string, "rating": "done"|"partly"|"missed"|"not_reached", "evidence": string|null, "note": string, "ownerLine": string, "closerLine": string, "fix": {"do": string, "say": string}|null}], "wentWell": [string], "objections": [{"theySaid": string, "handled": string, "tryThis": string}]${kind === "demo" ? ', "ownerMoments": [{"quote": string, "feeling": string, "closerNext": string, "howItWent": "strong"|"weak"|"none", "verdict": string, "tryThis": string}]' : ""}}`,
  "",
  "Rules:",
  "- READING LEVEL: write everything the reader sees at a third grade reading level. Use short everyday words. Keep sentences under 12 words, one idea each. Never use sales words such as discovery, qualify, consequence, reframe, transition, objection, rapport, insight, framework, leverage, value proposition, or pain point. Say what to do, not what to explore. Say owner, not prospect.",
  "- headline: one plain sentence on how the call went.",
  "- moments: FILL THIS FIRST, before anything else, by reading the whole call in order. A moment is each time the owner raised a worry, a pushback, a problem in their business, a question, or a sign of interest. 3 to 8 moments, in the order they happened, skipping small talk. ownerSaid is an exact quote of up to about 25 words from the Prospect's lines. closerReplied is an exact quote of up to about 30 words of what the Closer said right after, copied from the Closer's lines; look at the next few Closer turns, not just the first, because a follow up question can come a turn later; use an empty string if the Closer said nothing useful back or only spoke before the owner's line. howItWent: strong = the closer showed they heard it AND either answered it well or asked a follow up that got the owner to say more (what it costs them, how often, how it feels) or moved the call forward; weak = the closer only agreed, sympathised, praised or changed the subject, or asked about the topic but dropped it as soon as the owner answered; none = the closer ignored it. A closer who asks a question about a problem and then does nothing with the answer is weak, not strong. gap is one plain sentence on what a sharper closer would have done at that exact point, using the owner's own details (empty for strong).",
  "- nextSteps: 1 to 3 steps for the NEXT call, most important first. Each step must be built on ONE moment that you rated weak or none: moment is its number in the moments list, counting from 1. Never build a step on a strong moment, and never tell the closer to do what the Closer lines show they already did. Pick the weak moments that would have changed the result the most, and never use two steps for the same lesson. Two steps must rest on two DIFFERENT moments and quote two different owner lines: if only one moment was weak, give one step, not two. The Closer's words you describe must come AFTER the owner's line in the call, never before it. If every moment was strong, give one step that would make the call better still. when points at that moment: start with what the owner said and put a few of their exact words in double quotes, for example: When the owner said \"many people do not like talking to a machine\". do is one thing to do instead of what the closer did, starting with a verb, in plain words. say is the exact words to say, one or two short sentences, a question where the method calls for one, using the owner's own details. Never make up facts about the owner: do and say may only rely on things the owner actually said in the moment you point at (do not mention a tool, a system or a worry the owner never brought up). A step must make sense to someone who reads only that step, so when always quotes the owner.",
  "- Anything in moments rated strong also belongs in wentWell, naming it by what the owner said, never by its number.",
  "- Before you write a step, check ALL the Closer's later lines too: if the closer asked that question or made that point anywhere later in the call, the step is wrong, so drop it or pick another moment. Prefer moments where the owner revealed real stakes (a crash, lost jobs, lost money, hours of work, a personal cost) and the closer did not turn it into a number or a feeling (how often, what it cost, what it did to the day), because that is what moves an owner to want a fix. Prefer these over a closer who agreed politely.",
  "- stages: all the keys above, in the order given. note is one short plain sentence saying what happened. evidence is an exact quote of up to about 25 words copied character for character from ONE speaker in the transcript. Every done, partly and missed step needs one: for done and partly it is the line that shows what was done; for missed it is the line where the step should have happened (for example the caller offering times before any time zone was asked). Use null only for not_reached. The quote must prove the note, so never quote an unrelated line (an email address does not prove a time was read back). Never write evidence that is not in the transcript. The note must agree with the rating and with the quote: do not write a note that says the step was done fully when the rating is partly. For EVERY step that is partly or missed, also give: ownerLine, an exact quote (up to about 25 words, from the Prospect only) of what the owner said that made this step the right moment, or an empty string if the owner said nothing relevant; closerLine, an exact quote (up to about 30 words, from the Closer only) of what the closer actually said at that moment, or an empty string if the closer said nothing about it; and fix, an object with do (one thing the closer should have done, starting with a verb, in plain words, using the owner's own details) and say (the exact words to say, one or two short sentences). Each partly or missed step must use its own moment: do not reuse the same quote on two steps unless one line really shows both. For done and not_reached steps leave ownerLine and closerLine empty and fix null. The fix must be something the closer did not do anywhere in the call.",
  "- wentWell: 2 to 4 specific things done well, each naming the moment. Leave the list shorter rather than flatter. Empty is allowed. If the closer did something the method asks for, such as asking what the owner wants to know, it belongs here with the moment named.",
  "- objections: one entry for each time the owner pushed back or hesitated (price, need to think, need to ask someone, already have something, not now). theySaid is a short exact quote of it, picked so it reads clearly: speech to text garbles money (for example '90 $9' for $99), so choose a clearer line from the same push back instead of showing a garbled number, handled says in one sentence what was done, tryThis is what to say instead, in plain words. Empty list if there were none. BEFORE you write tryThis, read the closer's lines after that push back. If the closer already said or asked what you would suggest, or something close to it, do not suggest it: say in handled that the closer did the right thing and quote a few of their words, and leave tryThis as an empty string. Only write tryThis for something the closer did NOT do.",
  ...(kind === "demo"
    ? [
        "- ownerMoments: 0 to 6 lines where the OWNER (the Prospect) showed a strong feeling or changed course. The moment is about the owner, but for each one you must also judge how the closer handled it, plainly and without softening. Look for: refusing something, saying the same complaint again, a personal stake (years in the trade, a time they need to be somewhere), blaming or doubting the closer, saying the call is a waste of their time, and a sudden spark of interest. Pick the lines that are unusual and tell us the most. Skip polite filler and plain facts. quote is an exact quote of up to about 25 words copied character for character from the Prospect's lines only, never from the Closer. feeling is one short plain sentence on what the owner felt. closerNext is one short plain sentence on what the closer did right after, in the closer's own words where you can. howItWent: strong = the closer showed they heard it and got the owner to say more or moved the call forward; weak = agreed, sympathised, praised or changed the subject; none = ignored it. verdict is one blunt plain sentence saying whether that was good or bad and why, for example: Weak. He agreed and moved on, so the owner never said what a lost client costs. Never write a neutral sentence that only repeats what happened. tryThis is the exact words the closer should have said instead, one or two short sentences using the owner's own details, or an empty string when howItWent is strong. Put them in the order they happened. Empty list if the owner showed nothing strong.",
      ]
    : []),
  ...(kind === "booking"
    ? [
        "- THE SCRIPT IS THE HOUSE METHOD. A caller who says the script's lines is following the method, so never mark a step down, and never write a fix, for saying what the script says. The script opens with 'can I ask what time you close today?', then what happens to calls after that, then 'have you considered using a voice agent?'. That is a full opener. Judge what the script does not cover: what the caller did when the owner pushed back, and the booking steps.",
        "- When the owner pushes back, check it against the house answers in the reference before you suggest anything. Do not tell the caller to ask a different question when the house answer was given. If the owner says they do not get enough calls or plays the problem down, do not coach the caller to dig for pain the owner said they do not have.",
        "- closerReplied is what the caller said AFTER the owner's line. A question the caller asked BEFORE the owner spoke is not a reply to it.",
      ]
    : []),
  ...(kind === "demo"
    ? [
        "- READ THE WHOLE REPLY. A closer's reply often runs across several turns: a short 'I got you' or 'okay' followed by a real answer or fix in the next turns is a full reply. Judge the closer by all of it. In closerReplied and closerLine quote the part that answers the owner, not only the first words.",
        "- WORK OUT WHAT THE OWNER MEANT before you describe a feeling. Read the lines around it. Do not give the owner a feeling they did not show. Speech to text mishears (for example 'checks' for 'texts', or '$1.20' for $120): when a word makes little sense, use the meaning that fits the lines around it, or leave it out.",
        "- A problem the owner plays down is not pain. If the owner says it is small or rare ('I don't miss that many'), say so, and do not coach the closer to dig for pain the owner said they do not have. Never quote only the half of a sentence that sounds like a problem.",
        "- 'missed' means the closer made no attempt anywhere in the call. If the closer did it in any form, for example worked out the cost out loud with the owner's own numbers, it is partly at most, and the note must say what was done.",
        "- Do not coach on a point the owner accepted straight away and moved on from. That is not a gap.",
        "- You are also given a list of EVERY question the closer asked. Before you write any fix, nextSteps entry, tryThis or 'did not ask', check that list. If a question like it is there, even much later in the call or in different words, the closer did it: drop the advice and put it in wentWell instead.",
      ]
    : []),
  "- Be fair and specific. Do not praise a step that was not done, and do not mark a step missed when it was done in different words. Judge the method, not the outcome: a sale that was lost can still be a well run call.",
  "- Never use an em dash.",
].join("\n");
}

const SYSTEMS: Record<Variant, string> = {
  demo: buildSystem("demo"),
  followup: buildSystem("followup"),
  booking: buildSystem("booking"),
};

function userPrompt(s: ReviewSource, kind: ReviewKind): string {
  const parts = [`Business: ${s.company}`];
  if (s.niche) parts.push(`Trade: ${s.niche}`);
  parts.push(`Length: about ${s.minutes} minutes`);
  if (s.closerQuestions && s.closerQuestions.length > 0) {
    parts.push(
      `\nEvery question the ${kind === "demo" ? "closer" : "caller"} asked, in order (the live demo is left out):\n` +
        s.closerQuestions
          .slice(0, 90)
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n"),
    );
  }
  parts.push(`\nTranscript of the ${kind === "demo" ? "demo" : "booking"} call:\n${s.transcript}`);
  return parts.join("\n");
}

const RATINGS: StageRating[] = ["done", "partly", "missed", "not_reached"];
const clean = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s*—\s*/g, ", ").trim() : "";
// A quote the model wrapped in marks of its own: the screen adds a pair, which
// showed as doubled marks. Not applied to `when`, whose own quotes are parsed.
const unq = (v: unknown) => clean(v).replace(/^["“”]+|["“”]+$/g, "").trim();
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A quote cut to about twenty words, so it fits a line of the fold. */
const shortQuote = (q: string, words = 20) => {
  const w = q.split(/\s+/);
  return w.length <= words ? q : `${w.slice(0, words).join(" ")}...`;
};

/**
 * Did the closer deal with this line of the owner's, anywhere after it?
 *
 * The review model kept calling a moment weak when the closer's real answer
 * came after the owner added another line ("I got you" / owner: "but if it
 * says a dollar" / "don't worry, we can set it up for a specific number"), and
 * kept advising a question the closer asked 50 turns later (Irvin's partner,
 * 2026-10-07). So every moment it rates weak is checked on its own: the owner's
 * line and the rest of the call go to a small second call, and the answer only
 * counts when the quote it gives is really in the closer's lines. Returns null
 * when the check cannot be made, which leaves the review's own rating alone.
 */
async function closerDealtWith(
  transcript: string,
  ownerQuote: string,
  key: string,
  closerHay: string,
): Promise<{ quote: string; why: string } | null> {
  try {
    const lines = transcript.split("\n");
    // The whole quote's words, ellipses ignored: a quote that opens "Let me..."
    // left two words once cut at the dots, and the check was skipped.
    const words = normalise(ownerQuote).split(" ").filter(Boolean);
    if (words.length < 3) return null;
    let at = -1;
    for (const n of [6, 5, 4, 3]) {
      if (words.length < n) continue;
      // Slide along the quote: the owner's line may start mid-turn.
      for (let i = 0; i + n <= Math.min(words.length, 14) && at < 0; i += 1) {
        const needle = words.slice(i, i + n).join(" ");
        at = lines.findIndex((l) => l.startsWith("Prospect: ") && normalise(l).includes(needle));
      }
      if (at >= 0) break;
    }
    if (at < 0) return null;
    const rest = lines.slice(at, at + 90).join("\n").slice(0, 16_000);
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You check one thing in a sales call transcript. Reply with one JSON object and nothing else: {\"addressed\": boolean, \"closerQuote\": string, \"why\": string}. 'addressed' is true if the Closer, at any later point in the lines given, gave a real answer, a fix or a reassurance that fits what the owner said, or asked a question that explores it, even in different words, even if the owner added another line first, and even if it came much later in the call. Judge the main point of the owner's line, not every detail in it. If the owner said they need to think it over or check with someone, the closer dealt with it by asking what that person will worry about or need, handling it, or setting up the next step to settle it. A short acknowledgement ('okay', 'sounds good', 'I got you'), agreeing, or repeating the owner's own words back does NOT count, and neither does a reply about something else. closerQuote is an exact quote of up to 20 words copied from a Closer line that does this, or an empty string. why is one short sentence at a third grade reading level: everyday words, under 12 words, one idea, and no words like address, concern, directly or intent. Always say 'the closer' or 'the owner', never 'he', 'she' or 'they', so it is clear who did what. Lines starting 'Demo' are the live demo, not the closer. Never use an em dash.",
          },
          { role: "user", content: `The owner said:\n${ownerQuote}\n\nThe call from that point on:\n${rest}` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
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
    const out = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as {
      addressed?: unknown;
      closerQuote?: unknown;
      why?: unknown;
    };
    const quote = unq(out.closerQuote);
    if (out.addressed !== true || !quote) return null;
    // The check's own claim is held to the same rule as every other quote.
    const pieces = quote.split(/\.\.\.|…/).map(normalise).filter(Boolean);
    if (pieces.length === 0 || !pieces.every((p) => ` ${closerHay} `.includes(` ${p} `))) return null;
    const why = clean(out.why);
    return { quote: shortQuote(quote), why: why.length <= 90 ? why : "" };
  } catch {
    return null;
  }
}

/**
 * Every step that is not "done" must say what happened and what to do, and a
 * "done" must have a quote (2026-10-07). Since the live agent stopped counting
 * as the closer, steps about the demo lost their only quote and were downgraded
 * to "partly" with nothing to show and nothing to do, which read as "you did
 * the right thing". One batched call finds the closer's own line for those, and
 * writes a fix for any partly or missed step that has none. A quote only counts
 * when it is really in the closer's lines; a downgraded step that gets one goes
 * back to "done".
 */
async function fillStages(
  stages: ReviewStage[],
  downgraded: Set<string>,
  s: ReviewSource,
  key: string,
  closerHay: string,
  kind: ReviewKind,
): Promise<void> {
  const lacking = stages.filter(
    (st) =>
      st.rating !== "not_reached" &&
      ((!st.evidence && !st.ownerLine && !st.closerLine) ||
        ((st.rating === "partly" || st.rating === "missed") && !st.fix)),
  );
  if (lacking.length === 0 || !s.transcript) return;
  const closerLines = s.transcript
    .split("\n")
    .filter((l) => l.startsWith("Closer: ") || l.startsWith("Our caller: "))
    .join("\n")
    .slice(0, 22_000);
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You finish a review of a sales call. For each step you are given, reply with the closer's proof and, where needed, a fix. Reply with one JSON object and nothing else: {\"steps\": [{\"key\": string, \"closerQuote\": string, \"fix\": {\"do\": string, \"say\": string} | null}]}. closerQuote is an exact quote of up to 25 words copied from one of the Closer's own lines where the closer actually does that step, not a nearby line, or an empty string if the closer did not do it. Never quote a line that starts with 'Demo'. fix is null if the step was done well. If the step was only partly done or missed, fix.do is one thing to do next time and fix.say is the exact words to say, in plain words. This call is the demo the owner agreed to: showing the sample first is expected and is never a fault. Write at a third grade reading level, short everyday words, sentences under 12 words. Say owner, not prospect. Never use an em dash.",
          },
          {
            role: "user",
            content: `${kind === "demo" ? "Closer" : "Caller"} lines from the call:\n${closerLines}\n\nSteps:\n${JSON.stringify(
              lacking.map((st) => ({
                key: st.key,
                step: st.label,
                rating: st.rating,
                note: st.note,
                needsFix: (st.rating === "partly" || st.rating === "missed") && !st.fix,
              })),
            )}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return;
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
    const out = (JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { steps?: unknown })
      .steps;
    for (const row of Array.isArray(out) ? out : []) {
      const r = row as { key?: unknown; closerQuote?: unknown; fix?: unknown };
      const st = lacking.find((x) => x.key === r.key);
      if (!st) continue;
      const quote = unq(r.closerQuote);
      const pieces = quote.split(/\.\.\.|…/).map(normalise).filter(Boolean);
      const real = pieces.length > 0 && pieces.every((p) => ` ${closerHay} `.includes(` ${p} `));
      if (real && !st.evidence && !st.ownerLine && !st.closerLine) {
        st.evidence = quote;
        if (downgraded.has(st.key)) st.rating = "done";
      }
      const fx = r.fix as { do?: unknown; say?: unknown } | null | undefined;
      const fixDo = clean(fx?.do);
      const fixSay = unq(fx?.say);
      if ((st.rating === "partly" || st.rating === "missed") && !st.fix && fixDo && fixSay) {
        st.fix = { do: fixDo, say: fixSay };
      }
    }
  } catch {
    // The review stands as it was.
  }
}

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
      max_tokens: 7000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEMS[variantOf(s, kind)] },
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
  // The closer's own lines, so the claim "you said X" can be checked. Demo
  // transcripts label them "Closer", booking ones "Our caller".
  const closerHay = normalise(
    s.transcript
      .split("\n")
      .filter((l) => l.startsWith("Closer: ") || l.startsWith("Our caller: "))
      .map((l) => l.replace(/^(Closer|Our caller): /, ""))
      .join(" "),
  );

  // Moments the review rated weak that the closer in fact dealt with, found by
  // a second look at the rest of the call (see `closerDealtWith`).
  const dealt = new Map<string, { quote: string; why: string }>();
  if (kind === "demo") {
    const weak = new Set<string>();
    const add = (q: unknown) => {
      const t = unq(q);
      if (t) weak.add(t);
    };
    for (const x of list(raw.moments)) {
      const o = x as { ownerSaid?: unknown; howItWent?: unknown };
      if (o.howItWent !== "strong") add(o.ownerSaid);
    }
    for (const x of list(raw.ownerMoments)) {
      const o = x as { quote?: unknown; howItWent?: unknown };
      if (o.howItWent !== "strong") add(o.quote);
    }
    for (const x of list(raw.objections)) add((x as { theySaid?: unknown }).theySaid);
    for (const x of list(raw.stages)) {
      const g = x as { ownerLine?: unknown; rating?: unknown };
      if (g.rating === "partly" || g.rating === "missed") add(g.ownerLine);
    }
    const asked = [...weak].filter((q) => ownerSaid(q)).slice(0, 14);
    const found = await Promise.all(
      asked.map((q) => closerDealtWith(s.transcript as string, q, key, closerHay)),
    );
    asked.forEach((q, i) => {
      const f = found[i];
      if (f) dealt.set(normalise(q), f);
    });
  }
  const dealtWith = (q: unknown) => dealt.get(normalise(unq(q)));
  // Only worries the owner raised belong in "what went well", not every owner
  // line a step happened to point at.
  const momentKeys = new Set<string>();
  for (const x of list(raw.moments)) momentKeys.add(normalise(unq((x as { ownerSaid?: unknown }).ownerSaid)));
  for (const x of list(raw.ownerMoments)) momentKeys.add(normalise(unq((x as { quote?: unknown }).quote)));
  for (const x of list(raw.objections)) momentKeys.add(normalise(unq((x as { theySaid?: unknown }).theySaid)));

  const ownerMoments =
    kind === "demo"
      ? list(raw.ownerMoments)
          .map((x) => {
            const o = x as {
              quote?: unknown;
              feeling?: unknown;
              closerNext?: unknown;
              howItWent?: unknown;
              verdict?: unknown;
              tryThis?: unknown;
            };
            const how =
              o.howItWent === "strong" || o.howItWent === "weak" || o.howItWent === "none"
                ? (o.howItWent as "strong" | "weak" | "none")
                : undefined;
            const d = how === "strong" ? undefined : dealtWith(o.quote);
            if (d) {
              return {
                quote: unq(o.quote),
                feeling: clean(o.feeling),
                closerNext: d.quote,
                howItWent: "strong" as const,
                verdict: d.why || "The closer answered it.",
                tryThis: undefined,
              };
            }
            return {
              quote: unq(o.quote),
              feeling: clean(o.feeling),
              closerNext: clean(o.closerNext),
              howItWent: how,
              verdict: clean(o.verdict) || undefined,
              tryThis: how === "strong" ? undefined : unq(o.tryThis) || undefined,
            };
          })
          .filter((x) => x.quote && x.feeling && ownerSaid(x.quote))
          .slice(0, 6)
      : [];

  const saidBy = (hayOf: string, q: string) => {
    if (!hayOf) return inCall(q);
    const pieces = q.split(/\.\.\.|…/).map(normalise).filter(Boolean);
    return pieces.length > 0 && pieces.every((p) => ` ${hayOf} `.includes(` ${p} `));
  };
  const byKey = new Map(
    list(raw.stages).map((x) => [String((x as { key?: unknown }).key), x as Record<string, unknown>]),
  );
  const variant = variantOf(s, kind);
  const downgraded = new Set<string>();
  const stages: ReviewStage[] = (
    variant === "followup" ? FOLLOWUP_STAGES : kind === "demo" ? REVIEW_STAGES : BOOKING_STAGES
  ).map((def) => {
    const got = byKey.get(def.key);
    let rating = RATINGS.includes(got?.rating as StageRating)
      ? (got?.rating as StageRating)
      : "not_reached";
    let evidence = unq(got?.evidence) || null;
    if (evidence && !inCall(evidence)) evidence = null;
    // A "done" nobody can point to is not done, unless the evidence pass below
    // finds the closer's words for it.
    if (rating === "done" && !evidence) {
      rating = "partly";
      downgraded.add(def.key);
    }
    const g = got as { ownerLine?: unknown; closerLine?: unknown; fix?: unknown } | undefined;
    const ownerQ = unq(g?.ownerLine);
    const closerQ = unq(g?.closerLine);
    const fx = g?.fix as { do?: unknown; say?: unknown } | null | undefined;
    const fixDo = clean(fx?.do);
    const fixSay = unq(fx?.say);
    const gap = rating === "partly" || rating === "missed";
    // The owner's line was dealt with later: no fix is shown for it.
    const handledLater = gap && ownerQ ? dealtWith(ownerQ) : undefined;
    return {
      key: def.key,
      label: def.label,
      method: def.method,
      rating,
      evidence,
      note: clean(got?.note),
      ownerLine: gap && !handledLater && ownerQ && ownerSaid(ownerQ) ? ownerQ : undefined,
      closerLine:
        gap && !handledLater && closerQ && saidBy(closerHay, closerQ) ? closerQ : undefined,
      fix: gap && !handledLater && fixDo && fixSay ? { do: fixDo, say: fixSay } : undefined,
    };
  });

  await fillStages(stages, downgraded, s, key, closerHay, kind);

  // What the owner said and what the closer did about it. A quote that is not
  // in the right speaker's lines is cut, not shown.
  const padded = ` ${hay} `;
  const firstAt = (q: string) => {
    const piece = q.split(/\.\.\.|…/).map(normalise).filter(Boolean)[0];
    return piece ? padded.indexOf(` ${piece} `) : -1;
  };
  const lastAt = (q: string) => {
    const piece = q.split(/\.\.\.|…/).map(normalise).filter(Boolean)[0];
    return piece ? padded.lastIndexOf(` ${piece} `) : -1;
  };
  const moments = list(raw.moments).map((x) => {
    const o = x as { ownerSaid?: unknown; closerReplied?: unknown; howItWent?: unknown };
    const ownerSaidQ = unq(o.ownerSaid);
    const replied = unq(o.closerReplied);
    const d = o.howItWent === "strong" ? undefined : dealtWith(ownerSaidQ);
    const ownerOk = ownerSaidQ && ownerSaid(ownerSaidQ) ? ownerSaidQ : "";
    // A reply has to come after what it replies to. The model sometimes picks
    // the closer's question that PROVOKED the owner's line (2026-10-08,
    // Holzfaller), which then reads as "you said X" under advice about the
    // answer. The latest place the words occur has to be past the owner's line.
    const afterOwner = !ownerOk || !replied || lastAt(replied) > firstAt(ownerOk);
    return {
      ownerSaid: ownerOk,
      closerReplied: d
        ? d.quote
        : replied && saidBy(closerHay, replied) && afterOwner
          ? replied
          : "",
      strong: o.howItWent === "strong" || Boolean(d),
    };
  });

  // The moment each step points at. Quoted words that are not really in the
  // call are cut out rather than shown, the same rule the evidence follows.
  // A step must rest on a moment the closer handled weakly or not at all:
  // advice about something they did well is the bug this guards against.
  // Which moment a step is really about is decided by the owner's words it
  // quotes, not by the number the model gave: it wrote the same quote on two
  // steps that pointed at different moments (2026-10-08), so each printed the
  // same "When the owner said" over a different "You said". A step whose quote
  // sits in another moment is moved there, and two steps that end up on one
  // moment are one lesson, so the second is dropped.
  const within = (text: string, quote: string) => {
    const pieces = quote.split(/\.\.\.|…/).map(normalise).filter(Boolean);
    return pieces.length > 0 && pieces.every((p) => ` ${normalise(text)} `.includes(` ${p} `));
  };
  const usedMoments = new Set<number>();
  const usedLines = new Set<string>();
  const nextSteps = list(raw.nextSteps)
    .map((x) => {
      const o = x as { moment?: unknown; when?: unknown; do?: unknown; say?: unknown };
      const asked = Number(o.moment) - 1;
      const quoted = [...clean(o.when).matchAll(/["“]([^"“”]+)["”]/g)].map((q) => q[1]);
      const fits = (i: number) =>
        Boolean(moments[i]?.ownerSaid) &&
        quoted.length > 0 &&
        quoted.every((q) => within(moments[i].ownerSaid, q));
      const at = fits(asked) ? asked : moments.findIndex((_, i) => fits(i));
      const m = at >= 0 ? moments[at] : moments[asked];
      if (m?.strong) return null;
      if (at >= 0) {
        const line = normalise(moments[at].ownerSaid);
        if (usedMoments.has(at) || usedLines.has(line)) return null;
        usedMoments.add(at);
        usedLines.add(line);
      }
      const when = clean(o.when).replace(/["“]([^"“”]+)["”]/g, (all, q: string) =>
        inCall(q) ? all : "",
      );
      let tidy = when.replace(/\s+/g, " ").trim();
      // A pointer whose quote was cut ends mid-sentence ("When the owner said"),
      // which is worse than no pointer.
      tidy = tidy.replace(/\s+([.,;:])/g, "$1");
      if (/\b(said|asked|told you|answered)[\s:,.]*$/i.test(tidy) || tidy.length < 12) tidy = "";
      // The pointer was cut (its quote was not in the call): fall back to the
      // owner's line the step rests on. A step that points at nothing reads as
      // advice from nowhere ("what is number 2 even in context to"), so it is
      // dropped rather than shown bare.
      if (!tidy && m?.ownerSaid) tidy = `When the owner said "${m.ownerSaid}"`;
      if (!tidy) return null;
      // "You said" is only shown when the step is tied to a moment by its own
      // quote; a step the quote could not place has nothing safe to put there.
      return {
        when: tidy,
        do: clean(o.do),
        say: unq(o.say),
        youDid: at >= 0 ? m?.closerReplied || undefined : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.do && x.say))
    .slice(0, 3);

  const review: DemoReview = {
    headline: clean(raw.headline),
    stages,
    wentWell: [
      ...list(raw.wentWell).map(clean).filter(Boolean).slice(0, 4),
      // What the second look found the closer did after all.
      ...[...dealt.entries()]
        .filter(([k]) => momentKeys.has(k))
        .map(([, d]) => d)
        .filter((d, i, all) => all.findIndex((x) => x.quote === d.quote) === i)
        .slice(0, 2)
        .map((d) => `The owner had a worry. The closer answered it: "${d.quote}"`),
    ].slice(0, 5),
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    // Kept for reviews written before nextSteps; new ones leave it empty.
    toImprove: [],
    objections: list(raw.objections)
      .map((x) => {
        const theySaid = unq((x as { theySaid?: unknown }).theySaid);
        const d = dealtWith(theySaid);
        return {
          theySaid,
          handled: d
            ? `The closer dealt with it. The closer said: "${d.quote}"`
            : clean((x as { handled?: unknown }).handled),
          tryThis: d ? "" : clean((x as { tryThis?: unknown }).tryThis),
        };
      })
      .filter((x) => x.theySaid)
      .slice(0, 6),
    biggestFix: nextSteps[0]?.do ?? "",
    ownerMoments: ownerMoments.length > 0 ? ownerMoments : undefined,
    talk: s.talk,
    variant: variant === "followup" ? "followup" : undefined,
    recordingIds: s.recordingIds.length > 0 ? s.recordingIds : undefined,
  };
  return plainReadingLevel(review, key);
}

/**
 * Hold the review to a third grade reading level (2026-10-07).
 *
 * The prompt already asks for it and the model still writes "directly
 * addressing the owner's main point". So the text is measured, and anything with
 * a long sentence or a long word is rewritten in one small batched call. Quotes
 * (the owner's and the closer's own words) and the lines to say are never
 * touched, since they are what was or should be said. If the rewrite cannot be
 * used, the original text stays.
 */
const sentenceWords = (t: string) =>
  t
    .split(/[.!?]+\s/)
    .map((x) => x.split(/\s+/).filter(Boolean).length);
const needsPlainer = (t: string) =>
  t.length > 0 &&
  !/["“”]/.test(t) &&
  (Math.max(...sentenceWords(t)) > 13 || /[A-Za-z]{11,}/.test(t));

async function plainReadingLevel(review: DemoReview, key: string): Promise<DemoReview> {
  type Slot = { get: () => string; set: (v: string) => void };
  const slots: Slot[] = [];
  const add = (get: () => string, set: (v: string) => void) => {
    if (needsPlainer(get())) slots.push({ get, set });
  };
  add(() => review.headline, (v) => (review.headline = v));
  review.wentWell.forEach((_, i) =>
    add(() => review.wentWell[i], (v) => (review.wentWell[i] = v)),
  );
  review.stages.forEach((st) => {
    add(() => st.note, (v) => (st.note = v));
    if (st.fix) {
      const fx = st.fix;
      add(() => fx.do, (v) => (fx.do = v));
    }
  });
  review.nextSteps?.forEach((n) => add(() => n.do, (v) => (n.do = v)));
  review.objections.forEach((o) => add(() => o.handled, (v) => (o.handled = v)));
  review.ownerMoments?.forEach((m) => {
    add(() => m.feeling, (v) => (m.feeling = v));
    if (m.verdict) add(() => m.verdict as string, (v) => (m.verdict = v));
  });
  if (slots.length === 0) return review;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Rewrite each text so a third grader could read it. Use short everyday words. Keep every sentence under 12 words, one idea each. Keep the meaning, names and numbers. Add nothing new. Say owner, not prospect. Always say 'the owner' or 'the closer'. Never use 'he', 'she' or 'they' for either one, so it is clear who did what. Never use an em dash. Reply with one JSON object and nothing else: {\"texts\": [string, ...]} with exactly as many items as you were given, in the same order.",
          },
          { role: "user", content: JSON.stringify(slots.map((x) => x.get())) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return review;
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
    const out = (JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { texts?: unknown })
      .texts;
    if (!Array.isArray(out) || out.length !== slots.length) return review;
    slots.forEach((slot, i) => {
      const v = clean(out[i]);
      // Only a real rewrite that is not longer than what it replaces.
      if (v && v.length <= slot.get().length + 10) slot.set(v);
    });
  } catch {
    // The review is still good, just not simplified.
  }
  return review;
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
