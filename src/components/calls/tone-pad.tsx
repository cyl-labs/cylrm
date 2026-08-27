"use client";

import * as React from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TelnyxLine } from "@/components/calls/use-telnyx-call";

/**
 * The twelve keys a phone has, and the letters that have always been under
 * them. Nothing reads the letters — they are what makes the grid look like a
 * phone rather than a calculator.
 *
 * Defined here rather than in either screen because both the Keypad and the
 * dialler's tone pad draw them, and a pad that differed between the two would
 * be a second layout to learn on the screen where you are mid-call.
 */
export const PHONE_KEYS: { digit: string; letters?: string }[] = [
  { digit: "1" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*" },
  { digit: "0" },
  { digit: "#" },
];

/**
 * A tone pad for a call already in progress.
 *
 * This exists because a switchboard is the one thing a caller cannot talk
 * their way past: "press 1 for sales" reached a caller with no way to press
 * anything, and the standing advice became to hang up and mark the lead as a
 * callback — which threw away every business that puts a menu in front of its
 * owner.
 *
 * Distinct from the Keypad screen's pad, which is for typing a number *before*
 * a call. This one only ever sends tones down a live line, so it never edits
 * anything and there is nothing here to dial.
 */
export function TonePad({
  line,
  onClose,
}: {
  line: TelnyxLine;
  onClose: () => void;
}) {
  // What has been sent, so a caller can see they pressed 2 rather than 3. Kept
  // here rather than in the hook: it is a record of this visit to this menu,
  // and the next call starts from nothing.
  const [sent, setSent] = React.useState("");

  const press = (digit: string) => {
    line.sendDigit(digit);
    // Capped so a long menu cannot push the card's controls off a phone
    // screen; the tail is what someone is checking, not the head.
    setSent((s) => (s + digit).slice(-24));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border bg-muted/40 px-2.5">
          {sent ? (
            <span className="truncate text-[13px] font-semibold tabular-nums tracking-[0.08em]">
              {sent}
            </span>
          ) : (
            <span className="truncate text-[12px] text-muted-foreground">
              Tones go down the line
            </span>
          )}
        </span>
        {sent && (
          <button
            type="button"
            aria-label="Clear the tones shown"
            onClick={() => setSent("")}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Delete className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {PHONE_KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            aria-label={`Send ${k.digit}`}
            onClick={() => press(k.digit)}
            className="flex h-12 flex-col items-center justify-center rounded-xl border bg-background transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="text-[18px] font-semibold leading-none">
              {k.digit}
            </span>
            {k.letters && (
              <span className="mt-0.5 text-[9px] font-medium tracking-[0.12em] text-muted-foreground">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        className="h-10 w-full text-muted-foreground"
        onClick={onClose}
      >
        Close keypad
      </Button>
    </div>
  );
}
