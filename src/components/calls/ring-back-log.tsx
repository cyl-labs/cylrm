"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Clock, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookDemoFields } from "@/components/calls/book-demo";
import { useCallLine } from "@/components/calls/call-line";
import { useCallDrawn } from "@/components/calls/line-presence";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import { BookingPostCard } from "@/components/calls/slack-post";
import { CHANGED_CHANNEL } from "@/components/tab-sync";
import { callbackZoneLabel, defaultCallbackAt } from "@/lib/call-time";
import type { CallOutcome } from "@/lib/calls";
import type { RingBackToLog } from "@/lib/inbound";
import { cn } from "@/lib/utils";

/**
 * "Log your call with…" — a ring-back somebody answered, until it is logged.
 *
 * An answered inbound call never asked what came of it (2026-09-24). The
 * banner rang, the caller picked up, and when the call ended the screen went
 * back to whatever card was open — usually the business they had just finished
 * dialling, which is a different one. So the conversation was logged nowhere,
 * or logged on the wrong business: 26 of the 41 answered calls from a lead's
 * number in the fortnight before had nothing on that lead afterwards, and one
 * was Aaron's 164 seconds with a prospect that still read "No answer".
 *
 * - **The list comes from the server** (`getRingBacksToLog`), not from what
 *   this tab saw, so a reload, a second tab or a crash cannot lose one. It is
 *   asked again when a call picks up or ends, when anything is saved in any
 *   tab, and when the tab is looked at.
 * - **It shows during the call as well as after**, naming who is on the line.
 *   On the dial card the lead in front of you is still the one you were
 *   ringing, which is how the notes of one call ended up on another's row.
 * - **The outcome goes on their lead with this call's own session**, from the
 *   server's record of it rather than whatever the line carried last.
 * - Not modal and never blocking: hiding it keeps it, as a bar, and only a
 *   logged outcome or a founder's Skip settles it — the rule Missed calls
 *   follows, where only a founder may clear a lead's call with nothing said.
 */

/**
 * What a call somebody rang in for can end in. No answer and voicemail cannot
 * happen — they rang and we picked up — and a number that has just rung us is
 * not a bad one.
 */
const RING_BACK_OUTCOMES: CallOutcome[] = [
  "demo_booked",
  "callback",
  "gatekeeper",
  "not_interested",
];

function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RingBackLog({
  calBookingUrl,
  callerName,
  isAdmin,
}: {
  /** Passed in rather than read from `CalBookingProvider`, which wraps the
   *  page and not the layout's overlays. */
  calBookingUrl: string | null;
  /** Who is signed in, for the booking post a demo owes Slack. */
  callerName: string | null;
  /** Founders may skip one with nothing logged. */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { line, live } = useCallLine();
  const callDrawn = useCallDrawn();
  const [owed, setOwed] = React.useState<RingBackToLog[]>([]);
  const [readerTz, setReaderTz] = React.useState<string | null>(null);
  const [hiddenId, setHiddenId] = React.useState<number | null>(null);
  // A demo just logged here, until the caller says they have posted it — the
  // dial card's reminder, for the same reason: a toast is gone before they
  // are back from Cal.com.
  const [toPost, setToPost] = React.useState<string | null>(null);

  const busy = line.state !== "idle";
  const active = line.state === "active";

  // How long each call ran, as this browser saw it, for a call whose hangup
  // has not reached the server yet when it is logged.
  const seen = React.useRef(new Map<string, number>());
  React.useEffect(() => {
    if (busy && line.sessionId) seen.current.set(line.sessionId, line.seconds);
  });

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/inbound-calls/to-log", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        calls?: RingBackToLog[];
        readerTz?: string;
      };
      setOwed(data.calls ?? []);
      if (data.readerTz) setReaderTz(data.readerTz);
    } catch {
      // Best effort: the next call, save or glance asks again.
    }
  }, []);

  // On arrival, when a call picks up, and when it ends. Delayed a moment
  // because the server learns a call was answered from Telnyx's webhook, which
  // lands just after the browser knows.
  React.useEffect(() => {
    const t = setTimeout(() => void load(), active ? 2_000 : 1_000);
    return () => clearTimeout(t);
  }, [active, load]);

  // Whenever anything is saved, in this tab or another — logging the call on
  // the dial card or the Spreadsheet settles it just as well as logging it
  // here — and whenever the tab is looked at again.
  React.useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANGED_CHANNEL);
    if (channel) channel.onmessage = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // The call on the line now, when it is one of these, comes first.
  const onLine = busy
    ? owed.find((r) => r.sessionId === line.sessionId)
    : undefined;
  const current = onLine ?? owed[0] ?? null;
  const isLive = Boolean(onLine);

  // Read when the outcome is saved, never while drawing: the live timer while
  // the call is up, then the server's own length, then what this browser saw.
  const durationFor = (r: RingBackToLog): number | null =>
    busy && line.sessionId === r.sessionId
      ? line.seconds
      : (r.seconds ?? seen.current.get(r.sessionId) ?? null);

  function logged(r: RingBackToLog, outcome: CallOutcome) {
    setOwed((prev) => prev.filter((x) => x.id !== r.id));
    if (outcome === "demo_booked" && callerName) {
      setToPost(r.company ?? r.name ?? r.phone);
    }
    // Not under a live call: a refresh can move the dial card on to another
    // lead mid-conversation. `TabSync` holds its own back for the same reason.
    if (!busy) router.refresh();
  }

  if (!current && !toPost) return null;

  // Clear of the call bar the layout draws on screens without a dial card.
  const barShown = live && busy && !line.incoming && !callDrawn;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 sm:justify-end",
        barShown ? "bottom-20" : "bottom-4",
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 sm:w-[400px]">
        {toPost && callerName && (
          // Solid underneath: the post card is a tint, and this floats over
          // whatever screen is open — see the incoming-call banner.
          <div className="rounded-xl bg-card shadow-lg [&>div]:mb-0">
            <BookingPostCard
              name={callerName}
              lead={toPost}
              onDismiss={() => setToPost(null)}
            />
          </div>
        )}
        {current && (
          <RingBackCard
            // One form per call, so what is typed for one is never saved
            // against the next.
            key={current.id}
            row={current}
            live={isLive}
            more={owed.length - 1}
            readerTz={readerTz ?? "America/New_York"}
            calBookingUrl={calBookingUrl}
            isAdmin={isAdmin}
            hidden={hiddenId === current.id}
            onHide={(h) => setHiddenId(h ? current.id : null)}
            durationFor={durationFor}
            onLogged={logged}
            onSkipped={(r) => {
              setOwed((prev) => prev.filter((x) => x.id !== r.id));
              if (!busy) router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function RingBackCard({
  row,
  live,
  more,
  readerTz,
  calBookingUrl,
  isAdmin,
  hidden,
  onHide,
  durationFor,
  onLogged,
  onSkipped,
}: {
  row: RingBackToLog;
  /** The call is still up. */
  live: boolean;
  /** How many more are waiting behind this one. */
  more: number;
  readerTz: string;
  calBookingUrl: string | null;
  isAdmin: boolean;
  /** Folded down to one line. Kept mounted, so notes typed during the call
   *  survive being tucked away. */
  hidden: boolean;
  onHide: (hidden: boolean) => void;
  /** For the save only — it reads a ref. */
  durationFor: (r: RingBackToLog) => number | null;
  onLogged: (r: RingBackToLog, outcome: CallOutcome) => void;
  onSkipped: (r: RingBackToLog) => void;
}) {
  const [picked, setPicked] = React.useState<CallOutcome | null>(null);
  const [notes, setNotes] = React.useState("");
  const [email, setEmail] = React.useState(row.email ?? "");
  const [contact, setContact] = React.useState(row.name ?? "");
  const [callbackAt, setCallbackAt] = React.useState(() =>
    defaultCallbackAt(row.tz, readerTz),
  );
  const [saving, setSaving] = React.useState(false);

  const who = row.company ?? row.name ?? row.phone;

  async function save() {
    if (!picked || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLeadId: row.leadId,
          outcome: picked,
          notes,
          callbackAt: picked === "callback" ? callbackAt : undefined,
          contactEmail: picked === "demo_booked" ? email : undefined,
          contactName: picked === "demo_booked" ? contact : undefined,
          // This call's own session, from the server's record of it. Never
          // whatever the line carried last: that is how this very kind of
          // conversation came to be filed on another business's row.
          telnyxSessionId: row.sessionId,
          durationSeconds: durationFor(row) ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? `Could not save (${res.status}).`);
        return;
      }
      toast.success(`${OUTCOME_LABELS[picked]}: ${who}`);
      onLogged(row, picked);
    } catch {
      toast.error("Could not save: network error.");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (saving) return;
    setSaving(true);
    try {
      // Bodyless, which is the Missed calls "Skip": stamps the call handled
      // with nothing logged. Founders only, enforced by the route.
      const res = await fetch(`/api/inbound-calls/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not skip that. Try again.");
        return;
      }
      toast.success(`Skipped: ${who}`);
      onSkipped(row);
    } catch {
      toast.error("Could not skip that: network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Call to log"
      className="overflow-hidden rounded-xl border-2 border-primary bg-card shadow-lg"
    >
      {hidden ? (
        <button
          type="button"
          onClick={() => onHide(false)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted"
        >
          <PhoneIncoming className="size-4 shrink-0 text-primary" strokeWidth={2.2} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {live ? "On the phone with " : "Log your call with "}
            {who}
          </span>
          <span className="shrink-0 text-[13px] font-semibold text-primary">Open</span>
        </button>
      ) : (
        <div className="max-h-[calc(100svh-7rem)] overflow-y-auto">
          <div className="flex items-start gap-2 px-4 pt-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-primary">
                <PhoneIncoming className="size-3.5 shrink-0" strokeWidth={2.4} />
                {live ? "On the phone with" : "Log your call with"}
              </p>
              <p className="mt-1 truncate text-lg font-extrabold tracking-[-0.01em]">
                {who}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                They rang you back
                {!live && row.seconds !== null ? ` · ${mmss(row.seconds)}` : ""}
                {!live && (
                  <span suppressHydrationWarning>{` · ${ago(row.answeredAt)}`}</span>
                )}
                {row.listName ? ` · ${row.listName}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onHide(true)}
              aria-label="Hide for now"
              title="Hide for now"
              className="-mr-1.5 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="size-4" />
              Hide
            </button>
          </div>

          {/* What was said before they rang, which is usually why they did. */}
          {row.last && (
            <div className="mx-4 mt-2.5 rounded-lg bg-muted/50 px-3 py-2 text-[12px]">
              <p className="flex items-center gap-1.5 font-semibold">
                <Clock className="size-3 shrink-0 text-muted-foreground" />
                Before this:{" "}
                {OUTCOME_LABELS[row.last.outcome as CallOutcome] ?? row.last.outcome}
                <span className="font-normal text-muted-foreground" suppressHydrationWarning>
                  {` · ${ago(row.last.at)}`}
                  {row.last.by ? ` · ${row.last.by}` : ""}
                </span>
              </p>
              {row.last.notes && (
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                  {row.last.notes}
                </p>
              )}
            </div>
          )}

          <div className="px-4 pb-3.5 pt-3">
            <p className="text-[13px] text-muted-foreground">
              {live
                ? "Write down what they say as you go. When you hang up, pick how it went and log it here."
                : "Pick how it went and log it here. It goes on their record, not on whichever card you had open."}
            </p>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {RING_BACK_OUTCOMES.map((o) => (
                <Button
                  key={o}
                  variant={
                    picked === o
                      ? o === "not_interested"
                        ? "destructive"
                        : "default"
                      : "outline"
                  }
                  className={cn(
                    "w-full justify-start",
                    picked !== o &&
                      o === "not_interested" &&
                      "border-destructive/40 text-destructive hover:text-destructive",
                  )}
                  disabled={saving}
                  onClick={() => setPicked(picked === o ? null : o)}
                >
                  {OUTCOME_LABELS[o]}
                </Button>
              ))}
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they say?"
              aria-label={`Notes from your call with ${who}`}
              className="mt-2.5 min-h-[64px]"
            />

            {picked === "callback" && (
              <div className="mt-2.5 space-y-1.5">
                <Label htmlFor={`ring-back-cb-${row.id}`}>
                  {callbackZoneLabel(row.tz, readerTz)}
                </Label>
                <Input
                  id={`ring-back-cb-${row.id}`}
                  type="datetime-local"
                  value={callbackAt}
                  onChange={(e) => setCallbackAt(e.target.value)}
                />
              </div>
            )}

            {picked === "demo_booked" && (
              <div className="mt-2.5">
                <BookDemoFields
                  lead={row}
                  calBookingUrl={calBookingUrl}
                  email={email}
                  onEmail={setEmail}
                  contact={contact}
                  onContact={setContact}
                  idPrefix={`ring-back-demo-${row.id}`}
                  hint="Book the slot you agreed, then come back and log the call."
                />
              </div>
            )}

            <Button
              className="mt-3 h-11 w-full text-[15px]"
              disabled={!picked || saving}
              onClick={save}
            >
              <Check data-icon="inline-start" />
              {saving
                ? "Saving…"
                : picked
                  ? `Log ${OUTCOME_LABELS[picked].toLowerCase()}`
                  : "Pick how it went"}
            </Button>

            {(more > 0 || isAdmin) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground">
                  {more > 0
                    ? `${more} more call${more === 1 ? "" : "s"} to log after this`
                    : ""}
                </span>
                {/* Founders only, and a plain word for what it does: nothing
                    is written about the call. The route refuses a caller. */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void skip()}
                    disabled={saving}
                    className="rounded-md px-2 py-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    Skip, nothing to log
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
