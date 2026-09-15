"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A link anywhere in the message. Deliberately loose: a false alarm costs one
 *  glance, a missed one is how a signing link went out by accident. */
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(com|net|org|io|co|us|ai)\/\S*/i;

/**
 * The last look before something leaves the building.
 *
 * Every text and one-off email goes through this, because none of them can be
 * taken back. On 2026-09-15 a founder drafted Santa Fe Junk Removal's trial
 * agreement and texted the prospect its signing link seventeen seconds later
 * without meaning to: the Texts screen sent on Enter, the way Messages does, so
 * a paste and a keypress were the whole gesture. The link had to be killed by
 * archiving the contract in DocuSeal.
 *
 * - **It shows exactly what goes and to whom**, rather than asking "are you
 *   sure?", which people click through without reading.
 * - **A link gets a line of its own**, since that is the accident that happened.
 * - **"Go back" has the focus when it opens**, so the Enter that opened it
 *   cannot also send it. Sending takes a deliberate press on Send.
 * - **Going back keeps what was typed.** The composer only clears once the
 *   send is confirmed.
 */
export function ConfirmSend({
  open,
  kind,
  to,
  from,
  subject,
  body,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  kind: "text" | "email";
  /** Who it reaches, named the way the screen names them. */
  to: { name: string | null; address: string };
  /** Our number or mailbox it goes out from. */
  from?: string | null;
  subject?: string;
  body: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const hasLink = LINK.test(subject ?? "") || LINK.test(body);
  const noun = kind === "text" ? "text" : "email";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          box.current?.querySelector<HTMLElement>("[data-go-back]")?.focus();
        }}
      >
        <div ref={box} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Send this {noun}?</DialogTitle>
            <DialogDescription>
              {kind === "text"
                ? "It reaches their phone the moment you press Send. A text can't be unsent."
                : "It goes out the moment you press Send. An email can't be unsent."}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">To</dt>
            <dd className="min-w-0 break-words font-semibold">
              {to.name ? `${to.name} · ${to.address}` : to.address}
            </dd>
            {from && (
              <>
                <dt className="text-muted-foreground">From</dt>
                <dd className="min-w-0 break-words">{from}</dd>
              </>
            )}
          </dl>

          <div className="max-h-60 overflow-y-auto rounded-lg border bg-muted/40 px-3 py-2 text-[14px] leading-snug">
            {subject && <p className="mb-1.5 font-semibold">{subject}</p>}
            <p className="whitespace-pre-wrap break-words">{body}</p>
          </div>

          {hasLink && (
            <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
              <Link2 className="mt-0.5 size-4 shrink-0" />
              This has a link in it. Check it is the right link and that you mean
              to send it now.
            </p>
          )}

          <DialogFooter>
            <Button data-go-back variant="outline" onClick={onCancel}>
              Go back
            </Button>
            <Button onClick={onConfirm}>Send {noun}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
