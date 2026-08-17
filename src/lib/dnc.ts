/**
 * Do Not Call screening, for US numbers only.
 *
 * **Singapore is deliberately not screened.** The PDPA's DNC provisions do not
 * apply to business-to-business marketing, and every Singapore lead in here is
 * a company — moneylenders, workshops, clinics. Screening them anyway would
 * cost roughly SGD 220/year (PDPC charges ~SGD 0.02 per number and the result
 * expires after 21 days) to answer a question that is not being asked. If that
 * exemption is ever found not to cover a list, this is where it goes: add the
 * country back to `screened()` and write a `checkSingapore`. Note PDPC never
 * distributes the register, only answers per-number queries, so there is no
 * free local scrub the way there is in the US.
 *
 * Two separate things live here. The *policy* — how long a result is good for
 * and what makes a lead undialable — is ours and applies everywhere. The
 * *registry* is a third party. The policy is what protects you; the provider
 * is just where the answer comes from.
 *
 * No database import: the dial card and the spreadsheet are client components,
 * and `@/lib/calls` would drag the Postgres driver into the browser bundle —
 * the same reason `lib/website.ts` and `components/calls/outcome.ts` exist.
 */

/**
 * How long a result stays good.
 *
 * The TSR's safe harbour wants a scrub within 31 days. This is a legal window,
 * not a tuning knob: raising it does not make a stale check valid, it only
 * stops the app noticing.
 */
export const DNC_VALID_DAYS = 31;

export type DncStatus = "clean" | "listed";

export type DncFields = {
  dncStatus: DncStatus | null;
  dncCheckedAt: string | null;
};

/** Only US numbers are screened — see the note at the top of this file. */
export const screened = (country: string | null) => country === "us";

/**
 * Why this lead may not be rung, or null if it may.
 *
 * "Never checked" and "checked, and they are on the register" are both blocks.
 * They read differently because they need different actions — one is a scrub
 * you owe, the other is a lead you will never call — but neither is a number
 * anyone may dial.
 */
export function dncBlockReason(
  lead: DncFields,
  country: string | null,
  now: Date = new Date(),
): string | null {
  if (!dncEnforced()) return null;
  if (!screened(country)) return null;

  if (lead.dncStatus === "listed") return "On the US Do Not Call register";
  if (!lead.dncCheckedAt || lead.dncStatus !== "clean") {
    return "Not yet checked against the Do Not Call register";
  }

  const ageMs = now.getTime() - new Date(lead.dncCheckedAt).getTime();
  if (ageMs > DNC_VALID_DAYS * 24 * 60 * 60 * 1000) {
    return `Do Not Call check expired — results last ${DNC_VALID_DAYS} days`;
  }
  return null;
}

/**
 * Is screening switched on?
 *
 * Off unless explicitly enabled, and that default is load-bearing rather than
 * cautious: with no registry credentials every lead reads as "never checked",
 * so enforcing by default would block every US lead the day this shipped.
 * Turn it on once scrubbing actually runs.
 */
export function dncEnforced(): boolean {
  return process.env.DNC_ENFORCE === "1";
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type DncResult = {
  phone: string;
  status: DncStatus;
  detail: Record<string, unknown>;
};

export class DncNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DncNotConfiguredError";
  }
}

/** Overridable so a dev test can point at a local sink, in the same spirit as
 *  `TELEGRAM_API_BASE`. Never set this in prod. */
const rpvEndpoint = () =>
  process.env.RPV_API_BASE ??
  "https://api.realvalidation.com/rpvWebService/DNCPlus.php";
const RPV_TIMEOUT_MS = 10_000;

/**
 * RealPhoneValidation's DNC Plus.
 *
 * One number per request — the service has no batch endpoint — and they ask
 * for no more than 10 calls a second, so the caller paces this rather than
 * firing a whole list at once.
 *
 * The free alternative, if this ever looks expensive: the FTC *distributes*
 * the register, and the first five area codes cost nothing each year, so a
 * downloaded list plus a local set-membership test is free and instant. What
 * you give up is everything beyond the federal list — state registers, DMA,
 * and the litigator flag. That last one is the real reason to pay: a
 * professional TCPA plaintiff is a number worth keeping out of the queue.
 *
 * A number is `listed` if it appears on any of the four registers.
 */
export async function checkUnitedStates(phones: string[]): Promise<DncResult[]> {
  const token = process.env.RPV_TOKEN;
  if (!token) {
    throw new DncNotConfiguredError(
      "RPV_TOKEN is not set — get one from realphonevalidation.com, and a SAN " +
        "from telemarketing.donotcall.gov, before screening US numbers.",
    );
  }

  const out: DncResult[] = [];
  for (const phone of phones) {
    // Their parameter is a bare 10-digit NANP number: no +, no country code.
    const national = phone.replace(/\D/g, "").replace(/^1/, "");
    const url =
      `${rpvEndpoint()}?phone=${national}` +
      `&token=${encodeURIComponent(token)}&output=json`;

    // One failure does not discard the batch. Every lookup before it has
    // already been paid for, and throwing here would bin those results and
    // buy them again on the next tick. A number that could not be checked is
    // simply left unchecked, which already blocks it.
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(RPV_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      const flagged = (v: unknown) => {
        const s = String(v ?? "").toLowerCase();
        return s === "y" || s === "yes" || s === "true";
      };
      const listed =
        flagged(data.national_dnc) ||
        flagged(data.state_dnc) ||
        flagged(data.dma) ||
        flagged(data.litigator);

      out.push({
        phone,
        status: listed ? "listed" : "clean",
        // Kept whole. "clean" is our conclusion; this is what was actually
        // said, and the only place the four separate flags survive.
        detail: data,
      });
    } catch {
      continue;
    }
  }
  return out;
}
