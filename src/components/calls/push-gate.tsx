"use client";

import * as React from "react";
import { BellRing, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  currentSubscription,
  pushPermission,
  pushSupport,
  subscribeToPush,
} from "@/lib/push-client";

/**
 * Turning reminders on, asked the first time somebody opens Meetings.
 *
 * The screen only does its job if people are told to look at it, so this is
 * the first thing that happens rather than a button somebody may never notice.
 * It cannot be dismissed by clicking away or pressing Escape, and it has no
 * close cross.
 *
 * **It is not, and cannot be, a hard lock**, for two reasons worth writing
 * down before anyone tries to make it one:
 *
 *  1. No browser lets a site force a permission grant. `requestPermission`
 *     needs a real click and the person can always refuse, so a page that
 *     refuses to continue without one is a page that can be made unusable from
 *     outside our control.
 *  2. Refusing is permanent from our side. Once a browser records "denied" it
 *     answers every later request itself without asking anybody, so a caller
 *     who mis-clicks Block on the browser's own prompt would be locked out of
 *     the screen they need to do the work — forever, and over a mis-click.
 *
 * So the way past it always exists, and it comes back on the next visit
 * instead of being remembered as a decision. Persistent rather than
 * inescapable is the strongest thing that is also safe.
 */
export function PushGate({ vapidKey }: { vapidKey?: string }) {
  const [open, setOpen] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!vapidKey) return;
    // Nothing to offer where push cannot work. An iPhone in an ordinary tab
    // gets the Add to Home Screen line in the header instead — blocking the
    // screen with a prompt nobody can accept helps no one.
    if (pushSupport() !== "ok") return;
    // Already refused in this browser's settings: the browser will not ask
    // again on our behalf, so a prompt here is a dead end.
    if (pushPermission() === "denied") return;
    // Skipped a moment ago. Per tab session rather than remembered for good,
    // so it returns tomorrow — the point is to keep asking.
    if (sessionStorage.getItem("cylrm-push-asked") === "1") return;

    let cancelled = false;
    currentSubscription().then((sub) => {
      // The browser's own answer beats any flag we could store.
      if (!cancelled && !sub) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [vapidKey]);

  function close() {
    try {
      sessionStorage.setItem("cylrm-push-asked", "1");
    } catch {
      // A browser with storage blocked just gets asked again. Harmless, and
      // far better than throwing inside a dialog somebody has to get past.
    }
    setOpen(false);
  }

  async function turnOn() {
    if (!vapidKey || busy) return;
    setBusy(true);
    try {
      const outcome = await subscribeToPush(vapidKey);
      if (outcome === "subscribed") {
        toast.success("Reminders on for this browser.");
        close();
      } else if (outcome === "denied") {
        // Not closed: the person needs to see what happened and what to do,
        // and this is the one state where the dialog has something new to say.
        setDenied(true);
      } else {
        toast.error("Could not turn reminders on.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        // No clicking away and no Escape. The way past is a button that says
        // what it does, so skipping is a choice somebody makes rather than
        // something they do by accident on the way to the list.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-md"
      >
        {denied ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 shrink-0 text-destructive" />
                Notifications are blocked
              </DialogTitle>
              <DialogDescription>
                Your browser has blocked notifications for this site, and it
                will not ask again on its own.
              </DialogDescription>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              To turn them on, click the padlock or the icon to the left of the
              address bar, find Notifications, and set it to Allow. Then reload
              this page.
            </p>
            <p className="text-[13px] text-muted-foreground">
              Until then, check this screen yourself at the start of every
              shift — anything in red is a meeting to ring and confirm.
            </p>
            <Button onClick={close} className="w-full">
              Continue to Meetings
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BellRing className="size-5 shrink-0 text-primary" />
                Turn on meeting reminders
              </DialogTitle>
              <DialogDescription>
                Every booked demo needs a confirmation call the day before or
                on the day. A meeting nobody rang is the one that quietly does
                not turn up.
              </DialogDescription>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              Once a day, this browser will tell you how many meetings are
              waiting on a call. Nothing to install — your browser will ask you
              to allow it.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={turnOn} disabled={busy} className="w-full">
                {busy ? "Turning on…" : "Turn on reminders"}
              </Button>
              {/* Deliberately quiet, and deliberately present: see the note at
                  the top of this file for why there has to be a way past. */}
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
