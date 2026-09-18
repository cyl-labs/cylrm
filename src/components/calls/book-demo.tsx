"use client";

import * as React from "react";
import { CalendarPlus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calBookingHref } from "@/lib/cal-link";

/**
 * The booking step for a demo, wherever one is logged.
 *
 * It lived only in the dial card, so a demo set from the Spreadsheet or the
 * Pipeline board was saved with no booking step and nothing saying one was
 * still owed — which is how a demo agreed for Thursday on 2026-09-15 reached
 * the CRM with nothing on the calendar. The dial card, the Spreadsheet and the
 * board now share these fields, so the three cannot drift apart, and the
 * Meetings screen lists any demo that still slips through.
 */

/** The public booking link, from `CAL_BOOKING_URL`. Provided once by the app
 *  layout, so no screen has to pass it down through every component. Null when
 *  it is not configured, which hides the button. */
const CalBookingContext = React.createContext<string | null>(null);

export function CalBookingProvider({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  return (
    <CalBookingContext.Provider value={url}>{children}</CalBookingContext.Provider>
  );
}

export const useCalBookingUrl = () => React.useContext(CalBookingContext);

export type DemoLead = {
  id: number;
  company: string | null;
  phone: string;
  name: string | null;
  email: string | null;
  /** The prospect's own zone, from `leadZone` — the state, then the area code,
   *  then Singapore and the UK by prefix. Passed to Cal.com so the slots read
   *  in their local time rather than the caller's. Null for a number that
   *  belongs to no place, and then the page opens as it always did. */
  tz?: string | null;
};

/** What the booking step collects, in the shape `/api/calls` takes it: written
 *  back to the lead, because the email is what the invite and reminders go to. */
export type DemoDetails = { contactEmail: string; contactName: string };

export function BookDemoFields({
  lead,
  calBookingUrl,
  email,
  onEmail,
  contact,
  onContact,
  idPrefix = "demo",
  hint,
}: {
  lead: Omit<DemoLead, "id">;
  calBookingUrl: string | null | undefined;
  email: string;
  onEmail: (v: string) => void;
  contact: string;
  onContact: (v: string) => void;
  idPrefix?: string;
  hint: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        Booking the demo
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-email`}>Their email</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="name@company.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-contact`}>Who you spoke to</Label>
        <Input
          id={`${idPrefix}-contact`}
          value={contact}
          onChange={(e) => onContact(e.target.value)}
          placeholder="Name"
        />
      </div>
      {calBookingUrl && (
        // A new tab, never a navigation: leaving the page would lose the queue
        // position on the dial card and drop a live call anywhere. Cal.com's
        // own booking flow sends the invite and the reminders, so the caller
        // finishes there.
        <a
          href={calBookingHref(calBookingUrl, lead, { name: contact, email })}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-background text-sm font-bold transition-colors hover:bg-muted"
        >
          <CalendarPlus className="size-4 shrink-0" strokeWidth={2.2} />
          Book it on Cal.com
          <ExternalLink
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2.2}
          />
        </a>
      )}
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The booking step as a dialog, for the screens with no form of their own.
 *
 * - `log`: a demo is being logged as a new call.
 * - `correct`: the last call is being relabelled as a demo.
 * - `book`: the lead is already a demo, and its slot still has to be booked.
 *
 * The dialog saves nothing itself: `onConfirm` is the host's own save, handed
 * the details, so the Spreadsheet and the board keep their own optimistic
 * updates and error handling. It closes when that save succeeds.
 */
export function BookDemoDialog({
  lead,
  mode,
  onOpenChange,
  onConfirm,
}: {
  /** Null closes it. */
  lead: DemoLead | null;
  mode: "log" | "correct" | "book";
  onOpenChange: (open: boolean) => void;
  onConfirm?: (details: DemoDetails) => Promise<boolean>;
}) {
  const calBookingUrl = useCalBookingUrl();
  const [email, setEmail] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Seeded from the lead each time the dialog opens on one, adjusted during
  // render rather than in an effect.
  const [forId, setForId] = React.useState<number | null>(null);
  if (lead && lead.id !== forId) {
    setForId(lead.id);
    setEmail(lead.email ?? "");
    setContact(lead.name ?? "");
  }

  const who = lead?.company ?? lead?.name ?? lead?.phone ?? "";

  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "book" ? `Book ${who}'s demo` : `Demo booked: ${who}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "book"
              ? "This is logged as a demo but may not be on the calendar yet. Until it is, nothing reminds them and nobody is reminded to ring."
              : "Book the slot you agreed on Cal.com first, then save it here. Until it is on Cal.com, nothing reminds them."}
          </DialogDescription>
        </DialogHeader>
        {lead && (
          <BookDemoFields
            lead={lead}
            calBookingUrl={calBookingUrl}
            email={email}
            onEmail={setEmail}
            contact={contact}
            onContact={setContact}
            idPrefix="book-demo"
            hint="If they gave a different number to ring for the demo, change it on Cal.com, but leave the notes line alone: it is how the booking finds this lead."
          />
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {mode === "book" ? "Close" : "Cancel"}
          </Button>
          {onConfirm && (
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const ok = await onConfirm({
                    contactEmail: email.trim(),
                    contactName: contact.trim(),
                  });
                  if (ok) onOpenChange(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? "Saving…"
                : mode === "correct"
                  ? "Change to Demo booked"
                  : "Log Demo booked"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
