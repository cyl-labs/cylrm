/**
 * Reads a call transcript for a time to ring back (2026-10-02).
 *
 * Built after a founder's call with Santa Fe Junk Removal ("call me back
 * around twelve") left no trace in the CRM: a call back is only made by hand,
 * and nobody re-reads a one-minute call. The transcript has the promise in it.
 *
 * **A suggestion, never an action.** "Around twelve" does not say which day, or
 * whose clock, and a call back created behind a founder's back at the wrong
 * time is worse than none. What comes out of here is shown on the meeting card
 * with one tap to accept (`CallBackPrompt`, which shows the time on both
 * clocks before anything is saved).
 *
 * Plain `fetch` against OpenAI in the shape `meeting-brief.ts` established, on
 * the same model, with a `configured()` gate so an unset key is a quiet skip.
 * The model is asked for a date and a time; **the instant is worked out here**,
 * in the prospect's zone through `wallClockIn`, because a model doing time zone
 * arithmetic is exactly the mistake `parseCallbackAt` documents.
 */

import { wallClockIn } from "@/lib/call-time";
import type { TranscriptTurn } from "@/db/schema";
import { recordAiUsage } from "@/lib/ai-usage";

const API = "https://api.openai.com/v1/chat/completions";
// `gpt-4.1` since 2026-10-04 (was `gpt-4.1-mini`). Compared on 7 real calls with
// the same prompt: the same speed (about 2.8 s against 2.7 s) but far better at
// following the written rules, and about five times the price, which is still
// cents a month. The live objection hints stay on the mini, where speed matters.
const MODEL = "gpt-4.1";
const TIMEOUT_MS = 30_000;
/** A callback further out than this is not a callback, it is a misreading. */
const MAX_AHEAD_DAYS = 14;

export const suggestionConfigured = () => Boolean(process.env.OPENAI_API_KEY);

export type CallbackSuggestion = { at: string; quote: string };

const SYSTEM = `You read a phone call between a founder (the caller) and a business owner (the prospect).
Decide whether they agreed on a specific time to speak again by phone: the prospect asked to be rung back at a time, or accepted a time the founder offered.
Every line starts with its time in the call, like [0:51].
Reply with JSON only: {"agreed": boolean, "kind": "clock" or "delay" or null, "date": "YYYY-MM-DD" or null, "time": "HH:MM" or null, "delay_minutes": number or null, "said_at": number or null, "quote": string}.
- kind "clock": a time of day was agreed ("around twelve", "tomorrow at 10", "Monday after lunch"). Give "date" and "time" on the PROSPECT'S local clock, 24 hour. Resolve against the call's own date and time, which are given to you. Decide am or pm from context. If only a time is given, the date is the call's date unless that time had already passed, then the next day.
- kind "delay": a wait counted from now was agreed ("in an hour", "in an hour and a half", "in twenty minutes", "give me half an hour"). Give "delay_minutes" as a number, and "said_at" as the call-time in seconds of the line where it was settled (the [m:ss] stamp turned into seconds). Do NOT work out a clock time for a delay.
- NEVER use a time that someone says about the present moment ("it's 3:00 now", "it's late"): it is often wrong or misheard. Only the call's own start time, given to you, tells you when the call happened.
- If no specific time or wait was agreed ("call me later", "I'll call you", "send me an email"), "agreed" is false.
- "quote" is the prospect's own words about the time, at most 120 characters.
- Do not invent anything. If unsure, "agreed" is false.`;

const stamp = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const asText = (turns: TranscriptTurn[] | null, text: string | null): string => {
  if (turns && turns.length > 0) {
    return turns
      .map(
        (t) =>
          `[${stamp(t.start)}] ${t.speaker === "caller" ? "Founder" : "Prospect"}: ${t.text}`,
      )
      .join("\n");
  }
  return text ?? "";
};

/** The call's own clock, in the prospect's zone, as the model is told it. */
function localStamp(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export async function readCallbackRequest(args: {
  turns: TranscriptTurn[] | null;
  text: string | null;
  startedAt: Date;
  tz: string;
}): Promise<CallbackSuggestion | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const transcript = asText(args.turns, args.text).trim();
  if (transcript.length < 40) return null;

  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `The call began on ${localStamp(args.startedAt, args.tz)} (${args.tz}), the prospect's local time.\n\nTranscript:\n${transcript.slice(-12_000)}`,
        },
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
    feature: "callback",
    model: MODEL,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  });
  let parsed: {
    agreed?: unknown;
    kind?: unknown;
    date?: unknown;
    time?: unknown;
    delay_minutes?: unknown;
    said_at?: unknown;
    quote?: unknown;
  };
  try {
    parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}");
  } catch {
    return null;
  }
  if (parsed.agreed !== true) return null;

  // The instant is ours to work out, never the model's: a wall-clock time in
  // the prospect's zone through `wallClockIn`, or a wait counted from the
  // moment in the recording it was settled. The first version left the model
  // to add "an hour and a half" itself, and it added it to the clock the
  // prospect had said out loud ("it's like 3:00") instead of to when the call
  // happened, so the call back landed three hours early.
  let at: Date | null = null;
  if (parsed.kind === "delay") {
    const mins = Number(parsed.delay_minutes);
    const saidAt = Number(parsed.said_at);
    // Needs a position in the recording; a transcript with no timing cannot
    // place a wait, and a guess would be worse than nothing.
    if (!args.turns || args.turns.length === 0) return null;
    if (!Number.isFinite(mins) || mins < 1 || mins > 12 * 60) return null;
    const lastStart = args.turns[args.turns.length - 1].start;
    if (!Number.isFinite(saidAt) || saidAt < 0 || saidAt > lastStart + 30) return null;
    at = new Date(args.startedAt.getTime() + saidAt * 1000 + mins * 60_000);
  } else {
    if (typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return null;
    if (typeof parsed.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.time)) return null;
    at = wallClockIn(`${parsed.date}T${parsed.time}`, args.tz);
  }
  if (!at) return null;
  const ahead = at.getTime() - args.startedAt.getTime();
  if (ahead <= 0 || ahead > MAX_AHEAD_DAYS * 86_400_000) return null;

  const quote =
    typeof parsed.quote === "string" ? parsed.quote.trim().slice(0, 140) : "";
  return { at: at.toISOString(), quote };
}
