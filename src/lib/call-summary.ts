/**
 * A short written summary of a long call (2026-10-02).
 *
 * Asked for as "an AI summary briefing of all calls over 5 minutes". The
 * briefing on a meeting row is written from the call that booked it; a demo, a
 * long follow-up or a ring back that ran twenty minutes had nothing. Nobody
 * replays seventeen minutes to remember what a prospect said, and a call that
 * long is where the detail is.
 *
 * Plain `fetch` against OpenAI in the shape `meeting-brief.ts` and
 * `callback-suggestion.ts` established, on the same model, metered through
 * `recordAiUsage` so it shows on Spend. No em dashes in the output, the rule
 * for anything a person reads; `briefLines` strips any that slip through.
 */

import type { TranscriptTurn } from "@/db/schema";
import { recordAiUsage } from "@/lib/ai-usage";

const API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 45_000;
/** A call of this length or more gets a summary. */
export const SUMMARY_MIN_MS = 5 * 60_000;
/** Trimmed from the front: what was agreed is at the end of a call. */
const MAX_CHARS = 16_000;

export const summaryConfigured = () => Boolean(process.env.OPENAI_API_KEY);

const SYSTEM = `You write a short summary of a phone call between a founder or caller (selling an AI phone receptionist to small service businesses) and a business owner (the prospect).
Write 4 to 7 plain bullet points, each starting with "- ". Cover, as they apply: who they spoke to and what the business does, what the prospect said about their situation or needs, objections or worries, anything agreed or promised (a time to call back, a trial, a contract, pricing discussed), and what happens next.
Rules: use only what the transcript says, never invent a name, number or commitment. Keep each bullet to one short sentence. No headings, no quotes longer than a few words, no advice, and never use an em dash.`;

const asText = (turns: TranscriptTurn[] | null, text: string | null): string => {
  if (turns && turns.length > 0) {
    return turns
      .map((t) => `${t.speaker === "caller" ? "Founder or caller" : "Prospect"}: ${t.text}`)
      .join("\n");
  }
  return text ?? "";
};

/** The summary, or null when there is too little to summarise. Throws naming
 *  the vendor if OpenAI refuses. */
export async function writeCallSummary(args: {
  turns: TranscriptTurn[] | null;
  text: string | null;
}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const transcript = asText(args.turns, args.text).trim();
  if (transcript.length < 200) return null;

  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Transcript:\n${transcript.slice(-MAX_CHARS)}` },
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
    feature: "summary",
    model: MODEL,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  });
  const out = body.choices?.[0]?.message?.content?.trim();
  return out || null;
}
