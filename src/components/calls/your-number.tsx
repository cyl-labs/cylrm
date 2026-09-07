"use client";

import * as React from "react";
import { Check, Copy, Phone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * The number this person rings from, said out loud on the screen they start
 * the day on.
 *
 * It exists because a caller asked what their number was and the app had no
 * answer for them anywhere. It is assigned on the Team screen, which is
 * admin-only; it appears as a caller ID on somebody else's handset, which they
 * never see; and the script's voicemail line — "give me a call back on …" —
 * asks them to read it out on every unanswered call. So the one person who has
 * to know it was the one person the CRM never told.
 *
 * The script itself now fills the number in where the placeholder was, which is
 * where it is needed mid-call. This is the other half: the label, on the screen
 * they open first, so the number is somewhere they can find deliberately rather
 * than only meeting it inside a sentence.
 */
export function YourNumber({
  number,
  className,
}: {
  /** Grouped for reading aloud already — see `spokenNumber`. Null for somebody
   *  who has not been assigned one, which is a state worth showing rather than
   *  hiding: it is the reason their script still says "[your number]". */
  number: string | null;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy: select the number and copy it manually.");
    }
  }

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-3",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        <Phone className="size-3.5" strokeWidth={2.2} />
        Your number
      </p>

      {number ? (
        <>
          {/* Tabular figures and no wrapping: a number that breaks across two
              lines is a number read out wrong. */}
          <p className="whitespace-nowrap text-[15px] font-extrabold tabular-nums tracking-[-0.01em]">
            {number}
          </p>
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${number}`}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold transition-colors",
              copied
                ? "border-transparent bg-success text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {copied ? (
              <Check className="size-3.5" strokeWidth={2.4} />
            ) : (
              <Copy className="size-3.5" strokeWidth={2.2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="text-[12px] text-muted-foreground">
            This is what shows on their phone, and the number to leave on a
            voicemail. Your script already has it in.
          </p>
        </>
      ) : (
        <>
          <p className="text-[15px] font-extrabold tracking-[-0.01em]">
            Not assigned yet
          </p>
          {/* Said plainly, with who fixes it: a caller cannot set this
              themselves, so an instruction they have no permission to follow
              would be worse than none. */}
          <p className="text-[12px] text-muted-foreground">
            Ask an admin to give you one on the Team screen. Until then your
            script has no number to leave on a voicemail.
          </p>
        </>
      )}
    </div>
  );
}
