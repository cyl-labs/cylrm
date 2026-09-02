"use client";

import { MessageSquareWarning, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Where to look, on a screen too narrow for the panel.
 *
 * The mobile half of the same decision the panel makes: point at a family of
 * objections, never at one line, and never hand over the words. A wrong family
 * costs a glance; a wrong line invites a caller to read out a scripted answer
 * to an objection nobody raised, which is what makes them sound foolish and the
 * tool untrustworthy.
 *
 * So this names the section and opens the library at it. It deliberately does
 * not render the script: below `xl` there is no room to show a family's worth
 * of options, and showing one of them would be exactly the teleprompter this
 * design rejects.
 */
export function ObjectionSuggestion({
  heard,
  category,
  onDismiss,
  onOpenLibrary,
  className,
}: {
  /** Verbatim quote the match rests on — the check on a wrong guess. */
  heard: string;
  /** The family it points at, e.g. "Price". */
  category: string;
  onDismiss: () => void;
  onOpenLibrary: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-top-1 rounded-lg border-2 border-l-8",
        "border-primary/30 border-l-primary bg-primary/5 p-3 text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
          Sounds like
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

      <p className="mt-0.5 text-base font-bold leading-snug">{category}</p>
      <p className="mt-1 text-xs italic text-muted-foreground">
        they said: “{heard}”
      </p>

      <button
        type="button"
        onClick={onOpenLibrary}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border bg-background px-3 py-2 text-[13px] font-semibold hover:bg-muted/50"
      >
        <MessageSquareWarning className="size-4" strokeWidth={2.2} />
        Open objection handling
      </button>
    </div>
  );
}
