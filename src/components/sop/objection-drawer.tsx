"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SopProse } from "@/components/sop/sop-prose";
import type { SopSection } from "@/lib/sop";
import { cn } from "@/lib/utils";

/**
 * Objection handling, over the top of the dialler.
 *
 * Mounted by `Dialler` itself, not by the lead card, and opened through the
 * shadcn `Sheet` — which renders through a Radix portal. A portal relocates
 * the DOM node and leaves the React tree alone, so nothing here can unmount
 * the dialler or anything it is holding, an in-progress call included.
 *
 * Cards start collapsed to their titles because the title *is* the objection,
 * in the prospect's own words: a caller who has just been told "I'm not
 * interested" is looking for that sentence, not reading. Eight or so fit above
 * the fold, which is the whole design constraint.
 */
export function ObjectionDrawer({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SopSection[];
}) {
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<number | null>(null);

  // A fresh search every time it opens. Whatever was typed during the last
  // call is never what this one is about.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setExpanded(null);
    }
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = React.useMemo(
    () =>
      sections
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !needle || s.search.includes(needle)),
    [sections, needle],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `sheet.tsx` deliberately sets no width for a side sheet, so it is set
          here — full width on a phone, a column on a desktop. */}
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        // The search box takes focus instead, so the sheet does not steal it
        // back on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="gap-2 border-b p-4">
          {/* No region badge: a caller sees one market's sheet and nothing
              else, so naming it on every open is noise. */}
          <SheetTitle className="text-sm">Objection handling</SheetTitle>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2.2}
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What did they just say?"
              className="h-9 pl-8"
              aria-label="Search objections"
            />
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="divide-y">
              {matches.map(({ s, i }, n) => {
                // A group heading each time the category changes. Skipped
                // while searching: the results are already narrow, and
                // headings would only push them off the screen.
                const newGroup =
                  !needle && s.category && s.category !== matches[n - 1]?.s.category;
                const isOpen = expanded === i;
                return (
                  <li key={s.title}>
                    {newGroup && (
                      <p className="bg-muted/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {s.category}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className={cn(
                        "flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                        isOpen && "bg-muted/40",
                      )}
                    >
                      <span className="mt-0.5 text-[11px] font-bold tabular-nums text-muted-foreground/70">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">
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
                      <div className="px-4 pb-3.5">
                        <SopProse html={s.html} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
