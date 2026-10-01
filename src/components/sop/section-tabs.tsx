"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Consecutive `## Examples | …` sections of a document, shown one at a time.
 *
 * Asked for on Demo Call Scripts (2026-10-01): two worked examples sat open
 * under the general template and took up most of the page. The prose of each
 * tab is rendered on the server and arrives here as a node, so only the
 * switching is client code. The panels not showing are `hidden`, not
 * unmounted, so the page's text stays searchable with Cmd-F.
 */
export function SectionTabs({
  tabs,
}: {
  tabs: { title: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="mt-3">
      <div
        role="tablist"
        aria-label="Examples"
        className="flex flex-wrap gap-1 border-b"
      >
        {tabs.map((t, i) => (
          <button
            key={t.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={active === i}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-bold transition-colors",
              active === i
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.title}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.title}
          role="tabpanel"
          id={`${base}-panel-${i}`}
          aria-labelledby={`${base}-tab-${i}`}
          hidden={active !== i}
          className="pt-1"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
