"use client";

import * as React from "react";
import Link from "next/link";
import { CirclePlay, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Per browser, and only ever "I have seen this". Nothing here is worth a
 *  column: the card removes itself on call count anyway, and this only saves
 *  the few days between watching it and passing that mark. */
const HIDDEN_KEY = "cylrm-guide-card-hidden";

/** Our own writes, since `storage` only fires in *other* tabs. */
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function hidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    // Private window, or site data blocked. Showing it is the safe side of
    // this: the worst case is one dismissed card coming back.
    return false;
  }
}

/**
 * The six-minute guide, offered on the screen a caller opens first.
 *
 * It exists because the guide was a row in a list of *calling scripts* —
 * the one place an experienced caller goes daily and a new one goes to read
 * the pitch, not to learn the tool. Somebody who does not know how the CRM
 * works has to already know where the answer lives in order to find it.
 *
 * **It expires on its own.** The caller's lifetime logged calls decide whether
 * it renders, so an experienced caller has never seen it and never will —
 * which is the whole design. A prompt that stays forever is one people learn
 * to look past, and then it is furniture on every screen for everybody.
 *
 * The X is a convenience on top of that, not the mechanism: somebody who
 * watches it on their first morning should not be shown it for another week.
 * Hidden per browser rather than per account for the same reason the theme is
 * — it is a preference about this screen, not a fact about the person.
 */
export function GuideCard({ href }: { href: string }) {
  /**
   * `useSyncExternalStore` rather than reading localStorage into state in an
   * effect. The server snapshot is "hidden", so the markup React hydrates
   * against matches what the server sent and the card appears on the pass
   * after — a caller who dismissed it never sees it flash back. Reading it
   * during render instead would be a hydration mismatch, and setting state in
   * an effect is what the React compiler refuses.
   */
  const show = !React.useSyncExternalStore(subscribe, hidden, () => true);

  if (!show) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-sm">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <CirclePlay className="size-5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold tracking-[-0.01em]">
          New here? Watch the six-minute guide.
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Where the calls come from, how to work a list, and what to do after
          each one. It is the whole tool, start to finish.
        </p>
        <Button asChild size="sm" className="mt-2.5">
          <Link href={href}>Watch it</Link>
        </Button>
      </div>
      <button
        type="button"
        aria-label="Hide this"
        title="Hide this"
        onClick={() => {
          try {
            localStorage.setItem(HIDDEN_KEY, "1");
          } catch {
            // Nothing to tell somebody who only wanted to close a card.
          }
          // Our own write, so `storage` will not fire here.
          listeners.forEach((fn) => fn());
        }}
        className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}
