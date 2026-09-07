/**
 * What the AI phone agent costs, and what those numbers read as on a contract.
 *
 * In a module with no database import, for the reason `payroll-rates.ts` is one:
 * the prepare-contracts dialog is a client component and has to render the
 * prices, so a value imported from anything that pulls in the Postgres client
 * would drag the driver into the browser bundle and fail the build.
 *
 * The prices live here rather than in the DocuSeal templates on purpose. A
 * template holds the wording; the CRM holds the numbers. Changing a price is
 * then one line in this file and every contract written afterwards picks it up,
 * instead of somebody opening two templates in a document editor and getting
 * one of them wrong.
 */

/** Cents, so a discount is integer arithmetic and no rounding can lose money.
 *  Every rate here divides exactly at 15% and 25%, and the assertion at the
 *  foot of this file keeps it that way if one is ever changed. */
export type Package = {
  id: PackageId;
  name: string;
  /** Null is unlimited, which is a different thing from zero and prints as a
   *  word rather than a number. */
  minutes: number | null;
  monthlyCents: number;
  /** Per minute over the included allowance. Zero for the unlimited plan,
   *  which is the honest figure: there is no overage, so it is billed at
   *  nothing. See the note on `contractValues`. */
  overageCents: number;
};

export type PackageId = "ring_rookie" | "phone_professional" | "call_commander";

export const PACKAGES: readonly Package[] = [
  {
    id: "ring_rookie",
    name: "Ring Rookie",
    minutes: 75,
    monthlyCents: 100_00,
    overageCents: 100,
  },
  {
    id: "phone_professional",
    name: "Phone Professional",
    minutes: 225,
    monthlyCents: 250_00,
    overageCents: 60,
  },
  {
    id: "call_commander",
    name: "Call Commander",
    minutes: null,
    monthlyCents: 2_000_00,
    overageCents: 0,
  },
] as const;

export type TermId = "monthly" | "six" | "twelve";

/**
 * The commitment, which is a discount and a clause rather than only a price.
 *
 * `minimumTerm` is what goes on the contract's MINIMUM TERM line, and Section 4
 * is written around those three exact strings — "None" switches the agreement
 * to month-to-month with the ordinary 7 days' notice, and anything else locks
 * the client in and makes the balance of the term fall due on early
 * termination. If a term is added here, that clause has to be read again: a
 * discount with no matching wording is one nobody can be held to.
 */
export type Term = {
  id: TermId;
  label: string;
  months: number;
  discountPct: number;
  minimumTerm: string;
};

export const TERMS: readonly Term[] = [
  {
    id: "monthly",
    label: "Month to month",
    months: 0,
    discountPct: 0,
    minimumTerm: "None",
  },
  {
    id: "six",
    label: "6 months — 15% off",
    months: 6,
    discountPct: 15,
    minimumTerm: "6 months",
  },
  {
    id: "twelve",
    label: "12 months — 25% off",
    months: 12,
    discountPct: 25,
    minimumTerm: "12 months",
  },
] as const;

export const packageById = (id: string): Package | undefined =>
  PACKAGES.find((p) => p.id === id);

export const termById = (id: string): Term | undefined =>
  TERMS.find((t) => t.id === id);

/** Integer cents throughout: 250_00 at 15% off is exactly 212_50, and doing it
 *  in dollars would land on 212.49999999999997. */
export const monthlyCents = (pkg: Package, term: Term): number =>
  Math.round((pkg.monthlyCents * (100 - term.discountPct)) / 100);

/** Two decimals and thousands separators, matching how the price list is
 *  written down — "1,700.00", not "1700". The contract puts "USD" and
 *  "/ month" either side of it, so this is the number alone. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The four fee fields on the paid agreement, as the strings that go into them.
 *
 * The unlimited plan is the one worth explaining. Its clause reads "Unlimited
 * minutes per month included. Minutes beyond this are billed at USD 0.00 per
 * minute" — which is slightly odd to read and exactly true, and it means the
 * unlimited plan needs no template of its own. A dash there would leave the
 * sentence broken on a document somebody signs.
 */
export function contractValues(
  pkg: Package,
  term: Term,
): {
  retainer: string;
  minutes_included: string;
  overage_rate: string;
  minimum_term: string;
} {
  return {
    retainer: money(monthlyCents(pkg, term)),
    minutes_included: pkg.minutes === null ? "Unlimited" : String(pkg.minutes),
    overage_rate: money(pkg.overageCents),
    minimum_term: term.minimumTerm,
  };
}

/** What the whole commitment comes to, for the dialog to say out loud before
 *  somebody sends a 12-month agreement. Null for month-to-month, which has no
 *  total to quote. */
export const commitmentCents = (pkg: Package, term: Term): number | null =>
  term.months === 0 ? null : monthlyCents(pkg, term) * term.months;
