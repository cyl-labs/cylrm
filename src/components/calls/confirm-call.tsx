"use client";

import * as React from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A last look before the phone actually rings somebody.
 *
 * Deliberately not `ConfirmSend`, which every text and one-off email goes
 * through. That one is built around a message: it takes a body, and it scans
 * that body for links because it exists after a signing link was texted to a
 * prospect by accident. A call has no body, so bending it into this shape would
 * mean a confirmation that shows an empty message and a link warning that can
 * never fire.
 *
 * It earns its place for the same reason the other one does, though. On the
 * lead's dial card you are in a calling rhythm and the press is the point; on a
 * meetings row you are usually reading -- checking a time, opening the booking
 * notes -- and the Call button sits inches from them. A stray tap there rings a
 * real prospect in the middle of their working day, and there is no taking that
 * back.
 *
 * **Cancel holds the focus when it opens**, the same rule `ConfirmSend`
 * follows: whatever keypress opened this must not also place the call.
 */
export function ConfirmCall({
  open,
  who,
  to,
  from,
  note,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The business, named as the screen names it. */
  who: string;
  /** Their number, as it will be dialled. */
  to: string;
  /** Ours it goes out from. */
  from: string;
  /** Anything worth saying before it rings -- the demo time, usually. */
  note?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          box.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
        }}
      >
        <div ref={box}>
          <DialogHeader>
            <DialogTitle>Ring {who}?</DialogTitle>
            <DialogDescription>
              {/* The numbers both ways round, because the one it comes *from*
                  is what the prospect sees and is worth a glance. */}
              Calling <span className="font-semibold tabular-nums">{to}</span>{" "}
              from <span className="font-semibold tabular-nums">{from}</span>.
            </DialogDescription>
          </DialogHeader>

          {note && (
            <p className="mt-1 text-[13px] text-muted-foreground">{note}</p>
          )}

          <DialogFooter className="mt-4 gap-2 sm:gap-2">
            <Button variant="outline" data-cancel onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>
              <Phone className="size-3.5" strokeWidth={2.4} />
              Call now
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
