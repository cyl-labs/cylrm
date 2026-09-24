/**
 * A demo brief as it is drawn, shared by the Briefing page and the fold on
 * each Meetings row so the two cannot render one brief two ways.
 *
 * Its own module, with no database import, because the fold is a client
 * component and `lib/meeting-brief.ts` is not.
 */

/** A brief that has been written, as the screens receive it. */
export type StoredBrief = { summary: string; generatedAt: string };

/**
 * The brief's bullets, one per line, without their markers.
 *
 * Plain lines rather than a markdown parser: the prompt asks for bullets and
 * nothing else, and a parser would be a dependency earning its keep on one
 * shape of output.
 */
export const briefLines = (summary: string): string[] =>
  summary
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
