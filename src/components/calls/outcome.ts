/**
 * Labels and category helpers, in a module with no database import.
 *
 * `@/lib/calls` pulls in the Postgres client, so a client component that
 * imports a *value* from it drags the driver into the browser bundle and the
 * page fails to build. Types are erased and safe; these are not.
 */
import type { CallCategory, CallOutcome, QueueLead } from "@/lib/calls";

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  gatekeeper: "Gatekeeper",
  callback: "Call back",
  not_interested: "Not interested",
  demo_booked: "Demo booked",
  trial: "Trial",
  won: "Won",
  lost: "Lost",
  bad_number: "Bad number",
};

/** The ones that happen on the phone. Trial, won and lost land days or weeks
 *  after the call, so the dialler does not offer them — they are set from the
 *  board or the spreadsheet. */
export const CALL_TIME_OUTCOMES: CallOutcome[] = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "demo_booked",
  "not_interested",
  "bad_number",
];

/** "Never called" is a category but not an outcome — nothing was logged. */
export const CATEGORY_LABELS: Record<CallCategory, string> = {
  ...OUTCOME_LABELS,
  uncalled: "Never called",
};

export function outcomeTone(outcome: CallOutcome) {
  if (outcome === "demo_booked" || outcome === "trial" || outcome === "won") {
    return "default";
  }
  if (
    outcome === "not_interested" ||
    outcome === "bad_number" ||
    outcome === "lost"
  ) {
    return "destructive";
  }
  return "secondary";
}

export const categoryTone = (category: CallCategory) =>
  category === "uncalled" ? "outline" : outcomeTone(category);

/** Chip order on the sheet: untouched, then still being chased, then down the
 *  pipeline, then the two ways of being finished with. */
export const CALL_CATEGORIES: CallCategory[] = [
  "uncalled",
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "demo_booked",
  "trial",
  "won",
  "lost",
  "not_interested",
  "bad_number",
];

export const categoryOf = (lead: QueueLead): CallCategory =>
  lead.lastOutcome ?? "uncalled";
