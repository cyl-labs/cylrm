/**
 * Do Not Call screening, for US numbers only, against a locally held register.
 *
 * **Singapore is deliberately not screened.** The PDPA's DNC provisions do not
 * apply to business-to-business marketing, and every Singapore lead in here is
 * a company. Screening them anyway would cost roughly SGD 220/year — PDPC
 * charges ~SGD 0.02 per number and a result expires after 21 days — to answer a
 * question that is not being asked. If that exemption is ever found not to
 * cover a list, `screened()` is the one place to change. Note there is no local
 * option there: PDPC never releases its register and answers only metered
 * per-number queries.
 *
 * The US works the opposite way round. The FTC *distributes* the register, and
 * the first five area codes cost nothing a year, so screening here is a set
 * membership test against `dnc_number` — free, instant, no rate limit, no third
 * party holding the answer. What it costs instead is a SAN from
 * telemarketing.donotcall.gov and re-downloading each area code before its
 * snapshot goes stale.
 *
 * No database import: the dial card and the spreadsheet are client components,
 * and `@/lib/calls` would drag the Postgres driver into the browser bundle —
 * the same reason `lib/website.ts` and `components/calls/outcome.ts` exist. The
 * lookup itself lives in the cron route, which is server-only.
 */

/**
 * How long a downloaded snapshot, and a lead's result from it, stay good.
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

/** The NANP area code, or null if this is not a US number we can place. */
export function areaCode(phone: string): string | null {
  const d = phone.replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? d.slice(0, 3) : null;
}

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
 * cautious: with no register loaded every lead reads as "never checked", so
 * enforcing by default would block every US lead the day this shipped.
 */
export function dncEnforced(): boolean {
  return process.env.DNC_ENFORCE === "1";
}
