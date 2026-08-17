"use client";

import { ScrollText } from "lucide-react";
import { SopProse } from "@/components/sop/sop-prose";
import type { SopSection } from "@/lib/sop";
import { cn } from "@/lib/utils";

/**
 * The script, beside the dial card.
 *
 * Read top to bottom on every call, so it is not behind a tap. It fills the
 * column that was empty to the left of the card on a desktop and sticks as the
 * page scrolls; below `xl` there is no room for a second column, so the
 * dialler offers it as a drawer instead.
 *
 * Deliberately not the objection drawer's component: objections are searched
 * and collapsed because you want one of fifteen, whereas a script is followed
 * in order, so collapsing it would only add taps.
 */
export function ScriptPanel({
  sections,
  className,
}: {
  sections: SopSection[];
  className?: string;
}) {
  if (sections.length === 0) return null;
  return (
    <div
      className={cn(
        "sticky top-4 max-h-[calc(100svh-6rem)] overflow-y-auto rounded-xl border bg-card p-4",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        <ScrollText className="size-3.5" strokeWidth={2.2} />
        Script
      </p>
      {/* Steps numbered, branches not — a conditional numbered in sequence
          reads as something you always say. See the document page. */}
      {(() => {
        let step = 0;
        let depth = 0;
        return sections.map((s) => {
          if (s.branch) depth = Math.min(depth + 1, 2);
          else {
            step += 1;
            depth = 0;
          }
          return (
            <section
              key={s.title}
              className={cn(
                "mt-4 first:mt-3",
                s.branch && "mt-3 border-l-2 border-dashed border-border pl-3",
                s.branch && depth >= 2 && "ml-4",
              )}
            >
              <h3
                className={cn(
                  "tracking-[-0.01em]",
                  s.branch
                    ? "text-[12px] font-bold text-muted-foreground"
                    : "text-[13px] font-extrabold",
                )}
              >
                <span
                  aria-hidden
                  className="mr-1.5 tabular-nums text-muted-foreground/70"
                >
                  {s.branch ? "↳" : String(step).padStart(2, "0")}
                </span>
                {s.title}
              </h3>
              <SopProse html={s.html} className="mt-1 text-[13px]" />
            </section>
          );
        });
      })()}
    </div>
  );
}
