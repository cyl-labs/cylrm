import { Loader2 } from "lucide-react";

/**
 * What a slow screen shows between the click and the page (2026-09-24).
 *
 * Asked for because Stats and Spend "take a couple of seconds", and in that
 * time nothing on screen said anything had happened: the old page stayed up,
 * the link did not change, and a click that is being worked on looks exactly
 * like one that missed. Measured on prod that day, server time alone:
 * Spreadsheet 4.2s, Pipeline 3.9s, Stats 2.1s, Team 1.5s, Call lists, a
 * list's dial screen and Callbacks about 1.1s, Keypad and Spend 0.8s,
 * Meetings 0.6s. Missed calls, Texts, Scripts, the Scoreboard and Payroll
 * answer in about 0.3s and have no loading screen: on those it would only
 * flash.
 *
 * - **Drawn as the page's own header** — the same height, padding and title as
 *   `PageShell` — so the page arriving reads as the rest of it filling in
 *   rather than as one screen being swapped for another.
 * - **No data at all**, so it can be shown the instant the link is pressed:
 *   `PageShell` counts badges before it draws, and a loading screen that waited
 *   on queries would be one more thing to wait for.
 * - **The spinner fades in after a beat**, so a load that turns out quick
 *   never flashes it.
 *
 * Used from each slow route's `loading.tsx`, which Next shows the moment
 * somebody navigates there.
 */
export function PageLoading({
  title,
  what,
}: {
  /** The page's name as its header shows it. Left out where the page names
   *  itself from data, like a list's own name, rather than show a wrong one. */
  title?: string;
  /** What is loading, in the words under the spinner. */
  what: string;
}) {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-card px-4 py-2.5 sm:px-7">
        {/* Where `PageShell` puts the menu button on a phone, held open so the
            title does not jump sideways when the page arrives. */}
        <span aria-hidden className="-ml-1 size-9 shrink-0 lg:hidden" />
        {title && (
          <h1 className="text-lg font-extrabold tracking-[-0.02em] sm:text-xl">
            {title}
          </h1>
        )}
      </header>
      <div
        role="status"
        aria-live="polite"
        className="flex flex-1 justify-center px-4 pt-24"
      >
        <p className="flex h-fit items-center gap-2.5 text-[14px] text-muted-foreground animate-in fade-in [animation-delay:250ms] [animation-duration:300ms] [animation-fill-mode:both]">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          Loading {what}…
        </p>
      </div>
    </div>
  );
}
