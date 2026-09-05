"use client";

import * as React from "react";
import { ArrowLeftRight, ChevronDown, MessageSquareWarning, ScrollText } from "lucide-react";
import { SopProse } from "@/components/sop/sop-prose";
import type { SopSection } from "@/lib/sop";
import { cn } from "@/lib/utils";

/**
 * Objection handling, permanently beside the dial card.
 *
 * This took the script's column, and the swap is the point. The script is read
 * top to bottom and is largely the same every call, so it can live behind a
 * tap; the objections are the part a caller has to *know*, and they were the
 * part hidden in a drawer.
 *
 * The hint marks one entry and opens it, with its whole family tinted around
 * it. Both, deliberately: measured on the regression set the exact entry and
 * the family are equally accurate — 39/40 either way — so there is nothing to
 * gain by being vague, and when the exact row is wrong the right one is
 * usually its neighbour, visibly inside the same tinted group.
 *
 * That equality only holds because the caller asks. One clean utterance with
 * their own last line for context is a far easier problem than the continuous
 * version faced, which had to judge every fragment of every call — and a hint
 * you asked for and disagree with costs a glance, where one that appeared
 * unbidden and was wrong cost trust in the whole thing.
 */
export function ObjectionPanel({
  sections,
  /** The family the hint pointed at, tinted as context. */
  highlight,
  /** The exact entry within it, marked and opened. */
  exact,
  /** What the prospect was heard to say. The check on a wrong match. */
  heard,
  /** What this column is showing. The other document is on the "o" key, so the
   *  pair always covers both and neither is ever out of reach. */
  kind = "objections",
  /** Swap the two. Absent means no control — the caller cannot change it. */
  onSwap,
  className,
}: {
  sections: SopSection[];
  highlight?: string | null;
  exact?: string | null;
  heard?: string | null;
  kind?: "objections" | "script";
  onSwap?: () => void;
  className?: string;
}) {
  const [opened, setOpened] = React.useState<number | null>(null);
  const [lastExact, setLastExact] = React.useState(exact);
  const groupRef = React.useRef<HTMLLIElement | null>(null);
  const hitRow = exact ? sections.findIndex((s) => s.title === exact) : -1;

  // Counted the way the script page counts, so the two cannot disagree about
  // which step is 03. Numbering by array index was invisible for as long as
  // every branch sat at the end of a document — the moment one landed in the
  // middle, every row below it read one higher here than on the page a caller
  // learned the pitch from.
  const stepNumbers = React.useMemo(() => {
    let step = 0;
    return sections.map((s) => (s.branch ? null : (step += 1)));
  }, [sections]);

  // A new answer opens its row. Adjusted during render rather than in an
  // effect, which would render the old row first and then correct it.
  if (exact !== lastExact) {
    setLastExact(exact);
    if (hitRow >= 0) setOpened(hitRow);
  }

  // Bring the group into view, and nothing more — no row is opened for them.
  // Scoped to this column: `scrollIntoView` would scroll the page and move the
  // dial card out from under a caller mid-call.
  React.useEffect(() => {
    if (!highlight) return;
    const el = groupRef.current;
    const box = el?.closest("[data-objection-scroll]");
    if (!el || !(box instanceof HTMLElement)) return;
    box.scrollTo({
      top: Math.max(0, el.offsetTop - box.offsetTop - 8),
      behavior: "smooth",
    });
  }, [highlight]);

  if (sections.length === 0) return null;

  return (
    <div
      className={cn(
        "sticky top-4 flex max-h-[calc(100svh-6rem)] flex-col rounded-xl border bg-card",
        className,
      )}
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="flex flex-1 items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {kind === "script" ? (
              <ScrollText className="size-3.5" strokeWidth={2.2} />
            ) : (
              <MessageSquareWarning className="size-3.5" strokeWidth={2.2} />
            )}
            {kind === "script" ? "Script" : "Objection handling"}
          </p>
          {onSwap ? (
            // Callers disagree about which belongs here and both are
            // defensible: somebody learning the pitch wants the script open,
            // somebody who knows it wants the objections, because that is what
            // they reach for under pressure. Their preference, not an admin's.
            <button
              type="button"
              onClick={onSwap}
              title={`Show the ${kind === "script" ? "objections" : "script"} here instead`}
              className="-m-1 flex shrink-0 items-center gap-1 rounded p-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeftRight className="size-3.5" strokeWidth={2.2} />
              {kind === "script" ? "Objections" : "Script"}
            </button>
          ) : null}
        </div>
        {heard ? (
          <p className="mt-1.5 truncate text-[11px] italic text-muted-foreground">
            heard: “{heard}”
          </p>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto" data-objection-scroll>
        {sections.map((s, i) => {
          const isOpen = opened === i;
          const isHit = Boolean(highlight) && s.category === highlight;
          const isExact = i === hitRow;
          const newGroup = s.category && s.category !== sections[i - 1]?.category;
          // The first row of the matched group is what gets scrolled to.
          const isGroupTop = isHit && newGroup;
          return (
            <li key={s.title} ref={isGroupTop ? groupRef : undefined}>
              {newGroup && (
                <p
                  className={cn(
                    "px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em]",
                    isHit
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground",
                  )}
                >
                  {s.category}
                  {isHit ? (
                    <span className="ml-2 font-semibold normal-case opacity-90">
                      sounds like this
                    </span>
                  ) : null}
                </p>
              )}
              <button
                type="button"
                onClick={() => setOpened(isOpen ? null : i)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                  isOpen && !isHit && "bg-muted/40",
                  // The family is tinted so the alternatives are visible; the
                  // matched row inside it is the loud one.
                  isHit && "border-l-4 border-primary/40 bg-primary/[0.05] pl-3",
                  isExact && "border-primary bg-primary/[0.14]",
                )}
              >
                <span className="mt-0.5 text-[11px] font-bold tabular-nums text-muted-foreground/70">
                  {/* Branch steps go unnumbered, as they do on the script page:
                      a conditional numbered in sequence reads as something you
                      always say. */}
                  {s.branch ? "↳" : String(stepNumbers[i]).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px] leading-snug",
                    isExact ? "font-bold" : "font-semibold",
                  )}
                >
                  {s.title}
                </span>
                <ChevronDown
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                  strokeWidth={2.2}
                />
              </button>
              {isOpen && (
                <div className={cn("px-4 pb-3.5", isHit && "bg-primary/[0.03]")}>
                  {/* The spoken lines only. The coaching prose around some
                      sections is for reading between calls, not during one. */}
                  <SopProse html={s.responseHtml || s.html} gutter={false} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
