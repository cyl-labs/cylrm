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

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import { recordAiUsage } from "@/lib/ai-usage";
import { DEMO_RECORDING_WHERE } from "@/lib/meetings";

const API = "https://api.openai.com/v1/chat/completions";
// `gpt-4.1` since 2026-10-04 (was `gpt-4.1-mini`). Compared on 7 real calls with
// the same prompt: the same speed (about 2.8 s against 2.7 s) but far better at
// following the written rules, and about five times the price, which is still
// cents a month. The live objection hints stay on the mini, where speed matters.
const MODEL = "gpt-4.1";
const TIMEOUT_MS = 45_000;
/** A call of this length or more gets a summary. */
export const SUMMARY_MIN_MS = 5 * 60_000;
/** Trimmed from the front: what was agreed is at the end of a call. */
const MAX_CHARS = 16_000;

export const summaryConfigured = () => Boolean(process.env.OPENAI_API_KEY);

const SYSTEM = `You write a short summary of a phone call between a founder or caller (selling an AI phone receptionist to small service businesses) and a business owner (the prospect).
Our callers follow a fixed script, so do not retell the call. The script asks: what time they close; what happens to calls after that (voicemail, someone answers, the owner answers, and whether someone is paid to be on call); whether they have considered or seen a voice agent; then offers a demo and books a time. Report what the prospect said at those points, and anything else notable, never what the caller or the script said.
Write plain bullet points, each starting with "- ". Use these labelled lines exactly as shown, each only when the prospect said something for it:
- Time: the time agreed for any call back or meeting and how relaxed they were about it, read from how the exchange went, because the salesperson sometimes rings an hour or two early. Say the day and time, one plain sentence on how they were about it (relaxed: picked at once, said yes easily, said they are around; particular: gave a window or a reason, pushed back, asked to move it), then end with "Fine to ring a little early." or "Better not to ring early." or "Unclear if ringing early is fine." Only when no time came up at all, write "No time came up."
- Decides: who makes the decision, only if the call says. Do not assume the person on the call decides.
- Reach: the best number, way or hours to reach them, or when not to ring.
- Trial: only when our caller suggested a trial (a free or 30 day trial), and how the prospect reacted. Leave it out if the caller did not.
- Warmth: one plain word (keen, interested, lukewarm, polite only) and the reason.
- Hours: when they close.
- After hours: what happens to calls once closed, in their words, and whether someone is paid to be on call.
- Voice agent: what they said when asked if they had considered or seen one, in plain words (for example: has not considered one, has not heard of it, already looked into it, already uses one).
- Demo: how they reacted to the demo offer or its pricing, an objection or hesitation only if they actually had one.
- Also said: up to two lines for anything notable the prospect said that is not part of the script: a bad experience, a competitor or tool they use, a plan, a person to ask for.
- Promised: anything either side promised to send or do.
- Gatekeeper: only when the person spoken to is not the owner or decision maker.
Then up to 3 plain bullets for anything else that matters, such as what was agreed and what happens next.
Rules: read a short answer against the question asked. If the caller asks whether they have considered, heard of or used a voice agent and the prospect says no, that means they have not, it is not a refusal and not a lack of interest. Only say they are not interested when they decline it after it was explained or offered. Use only what the transcript says, never invent a name, number or commitment. Keep each bullet to one short sentence. No headings, no quotes longer than a few words, no advice, and never use an em dash.`;

// A demo is a different conversation from the cold call that booked it (2026-10-06).
// The script above is the caller's; a founder running a demo follows none, so the
// same prompt scored a 80 minute demo on "Hours: not mentioned" and "Gatekeeper:
// not applicable" and said nothing of what the owner actually thought.
const DEMO_SYSTEM = `You write a short summary of a recorded sales demo between a founder or closer (selling an AI phone receptionist to small service businesses) and a business owner (the prospect).
This is the second call with the owner: a caller already booked it, so there is no script to follow and the owner has already heard the offer once. Part of the call may be a live demo, where the AI receptionist is added to the line and the founder plays a pretend customer. Do not summarise that stretch; just note that it was played and how the owner reacted afterwards. Long calls drift into small talk: skip it unless it explains a decision.
Write plain bullet points, each starting with "- ". Use these labelled lines exactly as shown, each only when the transcript supports it:
- Outcome: one sentence on where the call ended: bought, agreed a next step, thinking about it, or said no, and the main reason in the owner's words.
- Their setup: how the owner handles calls now (who answers, forwarding, any tool or service they use), in one or two short sentences.
- Biggest problem: what the owner said goes wrong or costs them, if anything. If they said nothing hurts, say so.
- Demo: how the owner reacted to hearing the AI receptionist.
- Pushback: each reason the owner gave for not going ahead, in their words, and whether the founder answered it. Up to three.
- Price: what the owner said about the price, only if it came up.
- Decides: who makes the decision, only if the call says.
- Next step: what was agreed, with the day and time if one was set. If nothing was agreed, write "Nothing agreed."
- Promised: anything either side promised to send or do.
- Also said: up to two lines for anything notable that helps a later call: a competitor or tool they use, a plan, a referral or a person to ask for.
Rules: use only what the transcript says, never invent a name, number or commitment. Report what the owner said, not what the founder said, except for what was promised or agreed. Keep each bullet to one short sentence. No headings, no advice, no quotes longer than a few words, and never use an em dash.`;

export type SummaryKind = "booking" | "demo";

/** Whether this recording is the demo of a meeting (the founders' call) rather
 *  than a caller's cold call. Same test as the "Demo call" button on Meetings. */
export async function summaryKindOf(recordingRowId: number | string, by: "id" | "recording_id" = "id"): Promise<SummaryKind> {
  const rows = (await db.execute(sql`
    select 1
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    join call_recording cr on ${DEMO_RECORDING_WHERE}
    where ${by === "id" ? sql`cr.id = ${recordingRowId}` : sql`cr.recording_id = ${String(recordingRowId)}`}
    limit 1
  `)) as unknown as unknown[];
  return rows.length > 0 ? "demo" : "booking";
}

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
  kind?: SummaryKind;
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
      max_tokens: 900,
      messages: [
        { role: "system", content: args.kind === "demo" ? DEMO_SYSTEM : SYSTEM },
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
