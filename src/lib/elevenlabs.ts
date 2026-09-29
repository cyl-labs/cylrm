/**
 * What ElevenLabs costs, read live from its own API.
 *
 * `GET /v1/user/subscription` answers the plan, the credits used against the
 * limit, any usage-based overage so far and the next invoice. Nothing here
 * writes. Unset `ELEVENLABS_API_KEY` means no line on Spend and nothing else
 * changes, the same rule Telnyx and the contract buttons follow.
 *
 * Cached for an hour like the Telnyx figures: the bill settles daily at best
 * and Spend is read a handful of times a month.
 */

export type ElevenLabs = {
  tier: string;
  status: string;
  /** What one billing period costs, in USD: the next invoice as charged. */
  periodUsd: number;
  /** The plan's own price per month, in USD, whatever the billing period. */
  monthlyUsd: number;
  /** Usage-based overage so far this period, in USD. */
  overageUsd: number;
  used: number;
  limit: number;
  /** Whether usage above the limit is billed rather than refused. */
  canExceed: boolean;
  resetsAt: Date | null;
  /** Credits burned per day over the last week, or null when unreadable. */
  burnPerDay: number | null;
  /** Days until the plan's credits run out at that pace, or null. */
  daysLeft: number | null;
};

/** Credits used per day over the last seven days, from the usage report. */
async function weeklyBurn(key: string): Promise<number | null> {
  try {
    const end = Date.now();
    const start = end - 7 * 86_400_000;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/usage/character-stats?start_unix=${start}&end_unix=${end}&aggregation_interval=day&breakdown_type=none`,
      { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8_000), cache: "no-store" },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { time?: number[]; usage?: Record<string, number[]> };
    const series = d.usage?.All;
    if (!series || !d.time) return null;
    // Days after now are zero-filled by the API, so only count days that began.
    let sum = 0;
    d.time.forEach((t, i) => {
      if (t <= end) sum += series[i] ?? 0;
    });
    return sum / 7;
  } catch {
    return null;
  }
}

const TTL_MS = 60 * 60_000;
let cached: { at: number; value: ElevenLabs | null } | null = null;

export function elevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

/** The current figures, or null when unconfigured or the API would not answer
 *  (the last good figures are kept in that case). */
export async function getElevenLabs(force = false): Promise<ElevenLabs | null> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return null;
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return cached?.value ?? null;
    const d = (await res.json()) as {
      tier?: string;
      status?: string;
      billing_period?: string;
      currency?: string;
      character_count?: number;
      character_limit?: number;
      can_extend_character_limit?: boolean;
      next_character_count_reset_unix?: number;
      current_overage?: { amount?: string | number } | null;
      next_invoice?: { amount_due_cents?: number } | null;
    };
    // The bill is USD. Anything else would need a rate we do not have here.
    if (d.currency && d.currency !== "usd") return cached?.value ?? null;

    const burnPerDay = await weeklyBurn(key);
    const left = Math.max((d.character_limit ?? 0) - (d.character_count ?? 0), 0);
    const periodUsd = (d.next_invoice?.amount_due_cents ?? 0) / 100;
    const yearly = d.billing_period?.startsWith("annual");
    const value: ElevenLabs = {
      tier: d.tier ?? "unknown",
      status: d.status ?? "unknown",
      periodUsd,
      monthlyUsd: yearly ? periodUsd / 12 : periodUsd,
      overageUsd: Number(d.current_overage?.amount ?? 0) || 0,
      used: d.character_count ?? 0,
      limit: d.character_limit ?? 0,
      canExceed: Boolean(d.can_extend_character_limit),
      resetsAt: d.next_character_count_reset_unix
        ? new Date(d.next_character_count_reset_unix * 1000)
        : null,
      burnPerDay,
      daysLeft: burnPerDay && burnPerDay > 0 ? left / burnPerDay : null,
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? null;
  }
}
