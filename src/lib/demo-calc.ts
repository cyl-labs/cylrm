import { PACKAGES, type Package } from "@/lib/packages";

/**
 * The demo's arithmetic, shared by the calculator and the closing script.
 *
 * A plain module rather than part of the calculator component: the script's
 * placeholders are filled from the same figures, and the document page (a
 * server component) needs `hasDemoFills` to decide which sections get filled.
 * A function exported from a "use client" file reaches a server component as a
 * reference, not something it can call.
 */

/** What an answered call runs to. The whole estimate hangs off this one
 *  number, so it is named rather than buried in an expression. */
export const MINUTES_PER_CALL = 2;
/** Weeks in a month. Four rather than 4.33, at the founders' request
 *  (2026-09-17): it is the sum a prospect can follow when it is said out loud.
 *  It counts 48 weeks of a 52-week year, so the minutes run about 8% under,
 *  and somebody right at a plan's limit can end up slightly over it. */
export const WEEKS_PER_MONTH = 4;

/** What this package would actually cost at that many minutes — the included
 *  price plus whatever overage the volume runs into. Unlimited never overruns
 *  by definition. */
export function costAt(pkg: Package, minutes: number): number {
  if (pkg.minutes === null) return pkg.monthlyCents;
  const over = Math.max(0, minutes - pkg.minutes);
  return pkg.monthlyCents + over * pkg.overageCents;
}

/**
 * Money the way somebody says it out loud: "$8,660", never "$8,660.00".
 *
 * `money` from `lib/packages` is the written form and stays right everywhere a
 * figure is read off a table or put on a contract. These lines are spoken to a
 * prospect, and nobody reads the cents.
 */
export const spokenMoney = (cents: number): string =>
  Math.round(cents / 100).toLocaleString("en-US");

/** Everything the two boxes decide, from what was typed into them. */
export function workOut(callsPerWeek: string, ticket: string) {
  const calls = Number(callsPerWeek);
  const job = Number(ticket);
  const hasCalls = callsPerWeek.trim() !== "" && Number.isFinite(calls) && calls > 0;
  const hasTicket = ticket.trim() !== "" && Number.isFinite(job) && job > 0;

  const callsMonthly = hasCalls ? calls * WEEKS_PER_MONTH : 0;
  const minutes = Math.round(callsMonthly * MINUTES_PER_CALL);
  // What they are losing, in cents, to keep every figure in the same unit.
  const lossCents = hasCalls && hasTicket ? Math.round(callsMonthly * job * 100) : 0;

  const priced = PACKAGES.map((p) => ({ pkg: p, cents: costAt(p, minutes) }));
  const cheapest = hasCalls
    ? priced.reduce((a, b) => (b.cents < a.cents ? b : a))
    : null;
  /**
   * The smallest package that covers them with no overage at all.
   *
   * Shown as a fact, never as the recommendation. Marking it "fits" and
   * highlighting it was actively wrong: at thirty missed calls a week it
   * pointed at Call Commander's $2,000 while Phone Professional would have
   * billed $271 for the same month.
   */
  const noOverage =
    PACKAGES.find((p) => p.minutes === null || minutes <= p.minutes) ?? PACKAGES[0];

  return {
    calls,
    job,
    hasCalls,
    hasTicket,
    callsMonthly,
    minutes,
    lossCents,
    priced,
    cheapest,
    noOverage,
  };
}

export type DemoNumbers = ReturnType<typeof workOut>;

/**
 * Placeholders in the closing procedure that the calculator can answer.
 *
 * Filled as the founder types, so the "too expensive" answer reads with the
 * prospect's own figures instead of asking somebody mid-demo to scroll back up
 * and cross-reference. A box still empty leaves its placeholder standing, the
 * same rule `[your number]` follows: a bracket is visibly a blank.
 */
const DEMO_FILLS: { token: string; of: (n: DemoNumbers) => string | null }[] = [
  {
    token: "[their calls]",
    of: (n) => (n.hasCalls ? n.calls.toLocaleString("en-US") : null),
  },
  {
    token: "[their average job]",
    of: (n) => (n.hasTicket ? `$${spokenMoney(n.job * 100)}` : null),
  },
  {
    // The package the calculator marks cheapest, at what it would bill at
    // their volume — the figure the procedure tells a founder to quote.
    token: "[the package price]",
    of: (n) => (n.cheapest ? `$${spokenMoney(n.cheapest.cents)}` : null),
  },
];

export const hasDemoFills = (html: string): boolean =>
  DEMO_FILLS.some((f) => html.includes(f.token));

/** The section's HTML with every answerable placeholder replaced. Values are
 *  numbers this module formatted, never typed text, so they are safe to put
 *  into markup as they are. */
export function fillDemoNumbers(html: string, n: DemoNumbers): string {
  let out = html;
  for (const f of DEMO_FILLS) {
    const value = f.of(n);
    if (value !== null) out = out.split(f.token).join(`<span data-fill>${value}</span>`);
  }
  return out;
}
