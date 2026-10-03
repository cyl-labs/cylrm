/**
 * A demo call review as the screens receive it. No database import: the fold
 * that draws it is a client component.
 */

export type StageRating = "done" | "partly" | "missed" | "not_reached";

export type ReviewStage = {
  key: string;
  label: string;
  method: "NEPQ" | "Challenger" | "Gong" | "Script";
  rating: StageRating;
  /** Exact words from the call that back the rating, or null. */
  evidence: string | null;
  note: string;
};

export type DemoReview = {
  headline: string;
  stages: ReviewStage[];
  wentWell: string[];
  /** Up to three steps for the next call, most important first (2026-10-04).
   *  `when` points at the moment in THIS call, `do` is one thing to do, `say` is
   *  the exact words. Absent on reviews written before this existed. */
  nextSteps?: { when: string; do: string; say: string }[];
  toImprove: { what: string; tryThis: string }[];
  objections: { theySaid: string; handled: string; tryThis: string }[];
  biggestFix: string;
  /** Counted from the transcript, never written by the model. */
  talk: { closerPercent: number; closerQuestions: number; minutes: number };
  /** The recordings this review was written from, so the fold can show which
   *  calls were analysed and pre-tick them next time (2026-10-03). Absent on
   *  reviews written before the picker existed. */
  recordingIds?: string[];
};

/** One recording a reviewer can choose to analyse. */
export type ReviewCall = {
  recordingId: string;
  /** "Demo call 2", "Call (Akshansh)", "Other call". */
  label: string;
  durationMs: number | null;
  /** Already formatted in the reader's zone. */
  startedLabel: string | null;
};

export type StoredReview = { review: DemoReview; generatedAt: string };
