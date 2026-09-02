"use client";

import * as React from "react";
import { ChevronDown, MessageSquareWarning } from "lucide-react";
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
 * The live hint highlights a row here rather than printing its own card. A card
 * answers one objection and teaches nothing — a caller reads it out and is no
 * better off next time. Pointing at a row in a list they can see all of means
 * they learn where things are, and after a fortnight they will find it before
 * the hint does. That is the outcome worth designing for; the hint is training
 * wheels, not the product.
 */
export function ObjectionPanel({
  sections,
  /** Index of the section the live hint matched, or null. */
  highlight,
  /** The second candidate, offered quietly under the first. */
  alternate,
  /** What the prospect was heard to say. The check on a wrong match. */
  heard,
  className,
}: {
  sections: SopSection[];
  highlight?: number | null;
  alternate?: number | null;
  heard?: string | null;
  className?: string;
}) {
  const [opened, setOpened] = React.useState<number | null>(null);
  const [lastHit, setLastHit] = React.useState(highlight);
  const rowRef = React.useRef<HTMLLIElement | null>(null);

  // A new hint opens its row and closes whatever was opened by hand: two open
  // rows in a narrow column puts the one that matters off-screen. Adjusted
  // during render rather than in an effect — the row to open is derived from
  // the prop, and an effect would render the wrong row first and then correct
  // it.
  if (highlight !== lastHit) {
    setLastHit(highlight);
    if (highlight !== null && highlight !== undefined) setOpened(highlight);
  }

  // Scrolling is a real side effect, so this one stays an effect. Scoped to
  // this column: `scrollIntoView` on the row would scroll the page and move the
  // dial card out from under the caller mid-call.
  React.useEffect(() => {
    if (highlight === null || highlight === undefined) return;
    const el = rowRef.current;
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
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
          <MessageSquareWarning className="size-3.5" strokeWidth={2.2} />
          Objection handling
        </p>
        {heard ? (
          <p className="mt-1.5 truncate text-[11px] italic text-muted-foreground">
            heard: “{heard}”
          </p>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto" data-objection-scroll>
        {sections.map((s, i) => {
          const isOpen = opened === i;
          const isHit = highlight === i;
          const isAlt = alternate === i;
          const newGroup = s.category && s.category !== sections[i - 1]?.category;
          return (
            <li key={s.title} ref={isHit ? rowRef : undefined}>
              {newGroup && (
                <p className="bg-muted/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {s.category}
                </p>
              )}
              <button
                type="button"
                onClick={() => setOpened(isOpen ? null : i)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                  isOpen && !isHit && "bg-muted/40",
                  // The hit is the only loud thing in the column. An accent bar
                  // rather than a filled row, so the words stay readable.
                  isHit && "border-l-4 border-primary bg-primary/10 pl-3",
                  isAlt && !isHit && "bg-primary/[0.04]",
                )}
              >
                <span className="mt-0.5 text-[11px] font-bold tabular-nums text-muted-foreground/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px] leading-snug",
                    isHit ? "font-bold" : "font-semibold",
                  )}
                >
                  {s.title}
                  {isAlt && !isHit ? (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      or this
                    </span>
                  ) : null}
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
                <div className={cn("px-4 pb-3.5", isHit && "bg-primary/[0.04]")}>
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
