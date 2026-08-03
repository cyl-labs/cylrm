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
  interested: "Interested",
  demo_booked: "Demo booked",
  bad_number: "Bad number",
};

/** "Never called" is a category but not an outcome — nothing was logged. */
export const CATEGORY_LABELS: Record<CallCategory, string> = {
  ...OUTCOME_LABELS,
  uncalled: "Never called",
};

export function outcomeTone(outcome: CallOutcome) {
  if (outcome === "interested" || outcome === "demo_booked") return "default";
  if (outcome === "not_interested" || outcome === "bad_number") {
    return "destructive";
  }
  return "secondary";
}

export const categoryTone = (category: CallCategory) =>
  category === "uncalled" ? "outline" : outcomeTone(category);

/** Chip order on the sheet: untouched first, then the ones still in play,
 *  then the ones that are finished with. */
export const CALL_CATEGORIES: CallCategory[] = [
  "uncalled",
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "interested",
  "demo_booked",
  "not_interested",
  "bad_number",
];

export const categoryOf = (lead: QueueLead): CallCategory =>
  lead.lastOutcome ?? "uncalled";
