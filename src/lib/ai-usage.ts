import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * What the app spends on OpenAI (2026-10-02).
 *
 * OpenAI reports a bill only to an admin key, which this server does not hold
 * (the key here makes requests and nothing else), so each call writes down its
 * own token usage and what it cost at these rates **when it was made**. The
 * figure on Spend therefore covers what this CRM used and nothing else on the
 * same OpenAI account, and starts on the day this shipped.
 *
 * Rates are dollars per million tokens and come from OpenAI's price list. They
 * are the one thing here that goes stale: if a model's price moves, change it
 * here and the past stays as it was recorded.
 */
const RATES: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  // Audio in at the audio rate, text out at the text rate.
  "gpt-4o-mini-transcribe": { input: 1.25, output: 5 },
};

export type AiFeature = "brief" | "hint" | "hint-audio" | "callback";

export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  brief: "Meeting briefings",
  hint: "Live objection hints",
  "hint-audio": "Hearing the prospect (hints)",
  callback: "Reading calls for a call back",
};

/**
 * Record one request. Never throws and never waits for anything that matters:
 * a metering failure must not fail a live hint or a briefing, so it is a
 * best-effort write whose error is logged and dropped.
 */
export async function recordAiUsage(args: {
  feature: AiFeature;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** When the response carried no usage (audio), a flat estimate in dollars. */
  fallbackUsd?: number;
}): Promise<void> {
  try {
    const rate = RATES[args.model];
    const input = Math.max(0, Math.round(args.inputTokens ?? 0));
    const output = Math.max(0, Math.round(args.outputTokens ?? 0));
    const usd =
      rate && (input > 0 || output > 0)
        ? (input * rate.input + output * rate.output) / 1_000_000
        : (args.fallbackUsd ?? 0);
    await db.execute(sql`
      insert into ai_usage (feature, model, input_tokens, output_tokens, cost_micros)
      values (${args.feature}, ${args.model}, ${input}, ${output}, ${Math.round(usd * 1_000_000)})
    `);
  } catch (err) {
    console.error("[ai-usage] could not record", err);
  }
}

export type AiSpend = {
  /** Dollars over the window. */
  total: number;
  requests: number;
  /** The earliest request on record, so the card can say what it covers. */
  since: Date | null;
  byFeature: { feature: string; label: string; usd: number; requests: number }[];
};

export async function getAiSpend(days: number): Promise<AiSpend> {
  const rows = (await db.execute(sql`
    select feature, count(*)::int as n, coalesce(sum(cost_micros), 0)::bigint as micros
    from ai_usage
    where at > now() - make_interval(days => ${days}::int)
    group by feature
    order by sum(cost_micros) desc
  `)) as unknown as { feature: string; n: number; micros: string | number }[];
  const [first] = (await db.execute(
    sql`select min(at) as first from ai_usage`,
  )) as unknown as { first: string | null }[];
  const byFeature = rows.map((r) => ({
    feature: r.feature,
    label: AI_FEATURE_LABEL[r.feature as AiFeature] ?? r.feature,
    usd: Number(r.micros) / 1_000_000,
    requests: Number(r.n),
  }));
  return {
    total: byFeature.reduce((s, r) => s + r.usd, 0),
    requests: byFeature.reduce((s, r) => s + r.requests, 0),
    since: first?.first ? new Date(first.first) : null,
    byFeature,
  };
}
