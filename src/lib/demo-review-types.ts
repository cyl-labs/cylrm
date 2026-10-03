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
  toImprove: { what: string; tryThis: string }[];
  objections: { theySaid: string; handled: string; tryThis: string }[];
  biggestFix: string;
  /** Counted from the transcript, never written by the model. */
  talk: { closerPercent: number; closerQuestions: number; minutes: number };
};

export type StoredReview = { review: DemoReview; generatedAt: string };
