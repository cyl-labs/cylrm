"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { SopProse } from "@/components/sop/sop-prose";
import type { SopSection } from "@/lib/sop";
import { cn } from "@/lib/utils";

/**
 * What the prospect might have just raised, and what to say about it.
 *
 * A suggestion the caller judges, never a teleprompter they read. Two earlier
 * designs got this wrong in opposite directions — one made them tap a chip to
 * open a drawer, which is friction at the moment they are stuck and talking;
 * the other rendered the words to say large and prominent, which invites
 * reading out whatever appeared, including the roughly one in three that is
 * wrong.
 *
 * So: the heard line leads and the options follow. It shipped visually quiet —
 * dashed border, muted everything — and that was an over-correction: a caller
 * on a live call reported almost not noticing it appear. Being ignorable when
 * wrong is a property of *showing the evidence*, not of being faint. It now
 * announces itself and still never covers the lead card or the dial controls.
 *
 * A caller who can see
 *
 *     Heard: "it would have to be Friday"
 *     → Brushing you off: "Call me back later / I'm busy."
 *
 * needs no judgement about the classifier — the quote and the label plainly
 * disagree, and they skip it. Showing only the label, or only the response,
 * hides exactly the information that makes a wrong hint harmless.
 */
export function ObjectionSuggestion({
  heard,
  matches,
  onDismiss,
  onOpenLibrary,
  className,
}: {
  /** Verbatim quote the match rests on. The check, so it is never omitted. */
  heard: string;
  /** The sections that might fit, best first — the sections themselves rather
   *  than indices, so nothing here has to rebuild the classifier's list in the
   *  same order. They may come from the objection sheet or the script. */
  matches: SopSection[];
  onDismiss: () => void;
  /** Fall back to searching by hand — the route that always works. */
  onOpenLibrary: () => void;
  className?: string;
}) {
  // Which of the shortlist is showing, and whether the notes are open. Both
  // reset for a new suggestion by the caller keying this on the candidate
  // list — the same construction `CallForm` and `CopyNumber` use, and cheaper
  // than an effect that clears them after the fact.
  const [picked, setPicked] = React.useState(0);
  const [showContext, setShowContext] = React.useState(false);

  const shown = matches[picked];
  if (!shown) return null;

  return (
    <div
      className={cn(
        // Loud enough to catch the eye mid-call, additive rather than covering.
        // The accent bar does the noticing; the content stays calm.
        "animate-in fade-in slide-in-from-top-1 rounded-lg border-2 border-l-8",
        "border-primary/30 border-l-primary bg-primary/5 p-3 text-sm shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
          Objection heard
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="-m-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* The objection, as large as anything on the card: it is the thing a
          caller is scanning for, and it is also the check — if it does not
          match what they just heard, they skip the rest. */}
      <p className="mt-0.5 text-base font-bold leading-snug">{shown.title}</p>
      <p className="mt-1 text-xs italic text-muted-foreground">
        they said: “{heard}”
      </p>

      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        Say this
      </p>

      {shown.responseHtml ? (
        <SopProse html={shown.responseHtml} gutter={false} className="mt-1" />
      ) : (
        <SopProse html={shown.html} gutter={false} className="mt-1" />
      )}

      {shown.contextHtml ? (
        <>
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", showContext && "rotate-180")}
            />
            {showContext ? "Hide notes" : "Why this"}
          </button>
          {showContext ? (
            <SopProse html={shown.contextHtml} gutter={false} className="mt-1 opacity-80" />
          ) : null}
        </>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
        {matches.map((m, i) =>
          i === picked ? null : (
            <button
              key={m.title}
              type="button"
              onClick={() => setPicked(i)}
              className="text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              or “{m.title}”
            </button>
          ),
        )}
        <button
          type="button"
          onClick={onOpenLibrary}
          className="ml-auto text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Not this — search
        </button>
      </div>
    </div>
  );
}
