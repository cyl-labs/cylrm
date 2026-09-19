"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,  Grid3x3,
  MapPin,
  Mic,
  MicOff,
  MessageSquareWarning,
  Ear,
  PhoneCall,
  PhoneOff,
  RotateCw,
  ScrollText,
  ShieldAlert,
  SkipForward,
  Undo2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import type { CallOutcome, QueueLead } from "@/lib/calls";
import type { SopSection } from "@/lib/sop";
import { ObjectionDrawer } from "@/components/sop/objection-drawer";
import { IncomingCall } from "@/components/calls/incoming-call";
import { BookDemoFields } from "@/components/calls/book-demo";
import { useObjectionHints } from "@/components/calls/use-objection-hints";
import { useClaimLine, useLineLeader } from "@/components/calls/line-presence";
import { useCallLine } from "@/components/calls/call-line";
import { type TelnyxLine } from "@/components/calls/use-telnyx-call";
import { callFailure } from "@/components/calls/call-failure";
import {
  LinePair,
  MergeControls,
  SavedLineList,
  type SavedLine,
} from "@/components/calls/second-line";
import { TonePad } from "@/components/calls/tone-pad";
import { BookingPostCard } from "@/components/calls/slack-post";
import { ObjectionPanel } from "@/components/sop/objection-panel";
import { ScriptDrawer } from "@/components/sop/script-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OUTCOME_LABELS, outcomeTone } from "@/components/calls/outcome";
import { dialableNumber, e164 } from "@/lib/phone";
// From `call-hours`, not `calls`: that one reaches for the database, and this
// is a client component. Same wall `outcome.ts` and `phone.ts` were built for.
import { CALLING_HOURS_LABEL } from "@/lib/call-hours";
import { placeLabel, placeShort } from "@/lib/place";
import { websiteHref, websiteLabel } from "@/lib/website";
import { LocalTime } from "@/components/calls/local-time";
import {
  callbackZoneLabel,
  defaultCallbackAt,
} from "@/lib/call-time";
import { cn } from "@/lib/utils";

/**
 * Left column keeps the lead in the queue, right column closes it out.
 *
 * Only the outcomes a cold call can actually end in. Trial, won and lost come
 * days or weeks later and are set from the board or the spreadsheet — putting
 * them here would mean six buttons on a phone for things that never happen
 * while the phone is at your ear.
 */

const KEEP: CallOutcome[] = ["no_answer", "voicemail", "gatekeeper", "callback"];
const CLOSE: CallOutcome[] = ["demo_booked", "not_interested", "bad_number"];

/**
 * The number, as a button that copies it.
 *
 * Calls are placed from a separate handset or softphone, so handing the number
 * to the clipboard beats a `tel:` link that would try to dial from whatever
 * device the browser happens to be on.
 *
 * Mounted with `key={lead.id}` at the call site so "Copied" cannot linger from
 * the previous number.
 */
function CopyNumber({
  phone,
  blocked,
}: {
  phone: string;
  blocked?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      // The country code is stripped: this is pasted into a Singapore keypad.
      await navigator.clipboard.writeText(dialableNumber(phone));
      setCopied(true);
      // Long enough to register, short enough that the next tap reads as new.
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy: select the number and copy it manually.");
    }
  }

  // Screening blocks the clipboard too, not just a dial button. Handing over a
  // number that may not be rung, on the assumption it will be dialled from a
  // desk phone instead, is the same call — the button is where the rule has to
  // bite, because this is the only way anyone dials today.
  if (blocked) {
    return (
      <div
        className="mt-4 flex h-14 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-muted/40 px-3 text-center"
        role="note"
      >
        <span className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0" strokeWidth={2.2} />
          Do not call
        </span>
        <span className="mt-0.5 text-[12px] text-muted-foreground/80">
          {blocked}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${phone}`}
      className={cn(
        "mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-xl text-lg font-extrabold tracking-[-0.01em] transition-colors",
        copied
          ? "bg-success text-primary-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary/80",
      )}
    >
      {copied ? (
        <Check className="size-5" strokeWidth={2.4} />
      ) : (
        <Copy className="size-5" strokeWidth={2.2} />
      )}
      {copied ? "Copied" : phone}
    </button>
  );
}

/**
 * Place the call from the browser.
 *
 * Sits above the copy button rather than replacing it: two callers still dial
 * from their own handsets, and a lead with no caller ID for its country has to
 * stay workable that way.
 */
function DialControls({
  lead,
  line,
  enabled,
  lines,
}: {
  lead: QueueLead;
  line: TelnyxLine;
  /** False when this caller works from their own phone. */
  enabled: boolean;
  /** Labelled numbers belonging to nobody — the demo line and its like. */
  lines: SavedLine[];
}) {
  // Whether the list of lines is open, and what the one that was picked is
  // called. Declared before the early returns below, which is where hooks have
  // to go; the parent keys this component on whether a call is up, so neither
  // survives into the next one.
  const [adding, setAdding] = React.useState(false);
  const [secondName, setSecondName] = React.useState("");
  // The tone pad, for the switchboards that answer instead of a person.
  const [padOpen, setPadOpen] = React.useState(false);
  // Whether this tab is the one holding the phone. Read here as well as where
  // the line is taken, because the alternative is a dial card that renders
  // nothing and explains nothing.
  const holder = useLineLeader();
  // Recorded as the call starts, so coming back to the dialler mid-call opens
  // on this lead rather than on whoever is top of the queue.
  const { setActiveLead, lastLeadId } = useCallLine();
  // Why the last call to *this* lead did not go through. Keyed on the lead so
  // moving on to the next card does not carry the warning with it.
  const failure = lastLeadId === lead.id ? callFailure(line.ended) : null;

  // Nothing at all, not even the fallback line. Telling someone who always
  // dials from their own phone that there is "no caller ID yet" is an apology
  // for a missing setup, when they are already working exactly as intended.
  if (!enabled) return null;
  // Lost the election: another tab has a calling screen open. Said out loud,
  // because an unexplained missing dial button reads as the phone being broken
  // — and the way out is one the caller can act on themselves.
  if (!holder) {
    return (
      <p className="mt-2 text-center text-[12px] text-muted-foreground">
        The phone is open in another CRM tab. Dial from there, or close it and
        reload this page.
      </p>
    );
  }
  const busy = line.state !== "idle";
  const blocked =
    lead.dncBlock ??
    (!lead.dialTo
      ? "This number cannot be dialled from here"
      : !lead.dialFrom
        ? `No caller ID for ${lead.phone.startsWith("+44") ? "UK" : lead.phone.startsWith("+1") ? "US" : "these"} numbers yet`
        : null);

  // The phone is not up yet, or not at all. Said out loud with the way out,
  // like every other branch in here — this one returned nothing until
  // 2026-09-19, and a card with no Call button and no reason reads as the
  // feature having disappeared. On 2026-09-18 that cost Alex ninety minutes on
  // a callback he could not dial, and he cleared it by logging a "No answer"
  // he never rang, because the gate above the card says No answer counts. The
  // Keypad has shown `line.problem` all along; only this screen threw it away.
  if (!line.ready && !busy) {
    return (
      <div
        role="status"
        className="mt-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-center"
      >
        <p className="text-[13px] font-bold">
          {line.problem ? "Your phone isn’t connected" : "Connecting your phone…"}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {line.problem
            ? `${line.problem} Reload to try again, or dial the number below on your own phone and log what happened.`
            : "A few seconds. The Call button appears as soon as it is ready."}
        </p>
        {line.problem && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => window.location.reload()}
          >
            <RotateCw data-icon="inline-start" />
            Reload
          </Button>
        )}
      </div>
    );
  }
  if (blocked) {
    return (
      <p className="mt-2 text-center text-[12px] text-muted-foreground">
        {blocked}. Dial it on your handset.
      </p>
    );
  }

  const mmss = `${Math.floor(line.seconds / 60)}:${String(line.seconds % 60).padStart(2, "0")}`;

  if (!busy) {
    return (
      <>
        {/* Said out loud, because a call the network refuses is over before
            anything rings and the card is back at its Call button — which
            reads as the button doing nothing. See `callFailure`. */}
        {failure && (
          <div
            role="status"
            className="mt-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5"
          >
            <p className="text-[13px] font-bold text-destructive">
              {failure.title}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {failure.advice}
            </p>
          </div>
        )}
        <Button
          className="mt-2 h-12 w-full text-[15px]"
          variant={failure?.logAs === "bad_number" ? "outline" : "default"}
          onClick={() => {
            // Whose call this is, so returning to the dialler mid-call opens on
            // them rather than on whoever is top of the queue.
            setActiveLead(lead.id);
            line.dial(lead.dialTo!, lead.dialFrom!);
          }}
        >
          <PhoneCall data-icon="inline-start" />
          {failure ? "Try again" : "Call"}
        </Button>
      </>
    );
  }

  // Somebody else is on the call, or about to be. The lead's own row says
  // "On hold" until the two are merged, which is the one thing that is not
  // obvious from hearing nothing.
  if (line.second) {
    return (
      <div className="mt-2 space-y-2">
        <LinePair
          line={line}
          firstLabel={lead.company || lead.name || lead.phone}
          secondLabel={secondName || "Second call"}
        />
        <MergeControls line={line} />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-muted/40 text-sm font-bold">
          {line.state === "active" ? (
            <span className="tabular-nums">{mmss}</span>
          ) : (
            <span className="text-muted-foreground">
              {line.state === "ringing" ? "Ringing…" : "Connecting…"}
            </span>
          )}
        </span>
        <Button
          variant="outline"
          className="h-12 w-12 p-0"
          aria-label={line.muted ? "Unmute" : "Mute"}
          onClick={line.toggleMute}
        >
          {line.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </Button>
        <Button
          variant="destructive"
          className="h-12 w-12 p-0"
          aria-label="Hang up"
          onClick={line.hangup}
        >
          <PhoneOff className="size-4" />
        </Button>
      </div>

      {/* The switchboard case. Only once they have answered — a menu cannot be
          answered while the phone is still ringing — and above "Add call"
          because it is needed in the first ten seconds of a call, before
          anyone has decided whether to show a demo. */}
      {line.state === "active" && (
        <div className="mt-2">
          {padOpen ? (
            <TonePad line={line} onClose={() => setPadOpen(false)} />
          ) : (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setPadOpen(true)}
            >
              <Grid3x3 data-icon="inline-start" />
              Keypad
            </Button>
          )}
        </div>
      )}

      {/* Only once they have answered: there is nobody to hear the demo while
          it is still ringing. Absent entirely when no number is labelled,
          rather than a button that opens onto nothing — there is no pad on
          this card to type one into, so the list is the whole feature. */}
      {lines.length > 0 && line.state === "active" && !padOpen && (
        <div className="mt-2 space-y-2">
          {adding ? (
            <>
              <SavedLineList
                lines={lines}
                onPick={(picked) => {
                  const to = e164(picked.phoneNumber);
                  if (!to || !lead.dialFrom) return;
                  setAdding(false);
                  setSecondName(picked.label);
                  line.addCall(to, lead.dialFrom);
                }}
              />
              <Button
                variant="ghost"
                className="h-10 w-full text-muted-foreground"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setAdding(true)}
            >
              <UserPlus data-icon="inline-start" />
              Add call
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * How to book, in the order it is done.
 *
 * This was a checklist of the three things that make a booking count, and it
 * was answering the wrong question. A caller who has just heard "yes" does not
 * need to be told the bar — they need to know what to do next, and the two
 * recorded demos we have both went wrong on the mechanics rather than on the
 * qualification: days offered before the calendar was open, the time zone
 * asked for after a day had already been proposed, then the better part of a
 * minute of silence working it out on the call.
 *
 * So it is now the procedure, numbered, in sequence. The old criteria are not
 * lost — the first is step 1, because it is a thing you do rather than a thing
 * you have, and all three are restated in one line at the foot, which is where
 * the payroll bar belongs.
 *
 * The steps are the script's "Once they say yes" section, cut to what fits
 * beside a live call. If that section changes, change this with it.
 *
 * On the card rather than behind a tap, and hard-coded rather than a document,
 * for the same reason as before: this is what earns the fee and it must not be
 * something anyone has to go and find.
 */
function HowToBook() {
  const STEPS: React.ReactNode[] = [
    <>
      Are they the <span className="font-bold">owner or decision maker</span>?
      Ask outright if you do not know.
    </>,
    <>
      Tap <span className="font-bold">Demo booked</span> below first — it shows
      which slots are free.
    </>,
    <>
      Take their name and best email. Read it back letter by letter.{" "}
      <span className="font-bold">No email? Book it anyway.</span>
    </>,
    <>
      Ask <span className="font-bold">what time zone they are in</span>. Never
      work it out from their number.
    </>,
    <>
      On Cal.com (no login needed), switch the time zone to theirs. Every slot
      then reads in their local time —{" "}
      <span className="font-bold">do not convert in your head</span>.
    </>,
    <>
      Offer two times on two different days, read off the slots in front of you.
      Nothing sooner than seven hours from now.
    </>,
    <>
      Say the time back with{" "}
      <span className="font-bold">&ldquo;in the morning&rdquo;</span> or{" "}
      <span className="font-bold">&ldquo;in the afternoon&rdquo;</span>.
      &ldquo;Five thirty&rdquo; is two appointments twelve hours apart.
    </>,
    <>
      Book it while they are still on the line, then confirm the day and time.
      With an email they also get an invite in the next minute and a reminder
      the day before.
    </>,
  ];
  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-3.5 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        How to book
      </p>
      <ol className="mt-1.5 flex flex-col gap-1">
        {STEPS.map((s, i) => (
          <li
            key={i}
            className="flex gap-2 text-[13px] leading-snug text-muted-foreground"
          >
            <span
              aria-hidden
              className="shrink-0 font-bold tabular-nums text-muted-foreground/70"
            >
              {i + 1}
            </span>
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ol>
      {/* The steps say how; this says whether it counted. One line rather than
          three boxes — it is the payroll bar, not a thing to work through. */}
      <p className="mt-2.5 border-t pt-2 text-[12px] leading-snug text-muted-foreground">
        Only counts if all three:{" "}
        <span className="font-bold">decision maker</span>,{" "}
        <span className="font-bold">interested</span>, and{" "}
        <span className="font-bold">a specific date and time agreed</span>.
        You are paid when they{" "}
        <span className="font-bold">
          pick up at that time and stay on while we add the agent
        </span>
        .
      </p>
    </div>
  );
}

function relative(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Outcome buttons, notes and the callback picker for one lead.
 *
 * Mounted with `key={lead.id}` so each new number starts clean — see the call
 * site. Everything it owns is scoped to the lead in front of you.
 */
function CallForm({
  lead,
  readerTz,
  onLogged,
  onSkip,
  calBookingUrl,
  line,
}: {
  lead: QueueLead;
  /** The caller's own clock, used only where the lead's number belongs to no
   *  place — a toll-free line. See `callbackZoneLabel`. */
  readerTz: string;
  /** Handed the outcome, not just the fact that something was saved: a booking
   *  is the one that owes Slack a post, and only this knows which was logged. */
  onLogged: (outcome: CallOutcome) => void;
  onSkip: () => void;
  calBookingUrl?: string;
  line: TelnyxLine;
}) {
  // What the line remembers of the call just made to this lead, for the case
  // the outcome is typed after it ended. Read at save time, not here.
  const { sessionFor, lastLeadId, forgetLead } = useCallLine();
  /**
   * Whether this tab rang this lead and has not written it down yet.
   *
   * `lastLeadId` is set the moment Call is pressed and cleared by `forgetLead`
   * once an outcome is saved, so it is exactly "you dialled this one and have
   * not said what happened". The remembered call is checked as well, because
   * `lastLeadId` is state and a reload takes it — which is the same reload
   * this memory was made to survive, and the one that would otherwise let a
   * call slip past unlogged.
   *
   * **The skip is blocked only here, never in general** (2026-09-20). Asked
   * for as "make it mandatory to log before moving on", which would be the
   * wrong rule: a caller who never rang — wrong card, screened number, dead
   * phone — would have to invent an outcome to get past the screen, and that
   * is precisely how sixteen calls nobody made were logged on 2026-09-18.
   * Tying it to a call actually being placed turns "log something to move on"
   * into "you rang them, say how it went", which nobody has to lie to satisfy.
   * Every outcome is still available, No answer included.
   */
  const rang = lastLeadId === lead.id || sessionFor(lead.id) !== null;
  const [notes, setNotes] = React.useState("");
  // Seeded from the lead so a number that already has them is one glance, not
  // one retype. What the prospect says on the call wins over the scrape.
  const [email, setEmail] = React.useState(lead.email ?? "");
  const [contact, setContact] = React.useState(lead.name ?? "");
  // Opens on the prospect's tomorrow morning, not the floor's: a callback is an
  // appointment with them. A lazy initialiser because it now takes an argument.
  const [callbackAt, setCallbackAt] = React.useState(() =>
    defaultCallbackAt(lead.tz, readerTz),
  );
  // Picked but not yet saved. Nothing is written until the confirm button is
  // pressed: one tap next to another used to be the whole gesture, and a
  // mis-tap became a call in the record that had to be found and corrected
  // later.
  const [picked, setPicked] = React.useState<CallOutcome | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    // Asked for once per save rather than per render: it is a ref read, and
    // the answer must be the state at the moment the button was pressed.
    const remembered = sessionFor(lead.id);
    const outcome = picked;
    if (!outcome || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLeadId: lead.id,
          outcome,
          notes,
          callbackAt: outcome === "callback" ? callbackAt : undefined,
          contactEmail: outcome === "demo_booked" ? email : undefined,
          contactName: outcome === "demo_booked" ? contact : undefined,
          // The session id is what the recording joins on; the duration is
          // this browser's timer. `line.sessionId` is live state and is gone
          // the moment the call ends, so an outcome typed a few minutes later
          // used to post neither — a real recorded call with no "Listen back",
          // for ever. The provider keeps the last finished call for this lead
          // and hands it back here.
          telnyxSessionId: line.sessionId ?? remembered?.sessionId,
          durationSeconds: line.seconds || remembered?.seconds || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Could not save (${res.status}).`);
        return;
      }
      toast.success(
        `${OUTCOME_LABELS[outcome]}: ${lead.company ?? lead.phone}`,
      );
      // Written down, so the call is no longer owed — this both releases the
      // skip and stops a second outcome on the same lead claiming the same
      // recording.
      forgetLead(lead.id);
      onLogged(outcome);
    } catch {
      toast.error("Could not save: network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes from the call…"
        className="mt-4 min-h-[64px]"
      />

      {/* The shared booking step: the Spreadsheet and the Pipeline board show
          the same fields, so a demo is booked the same way wherever it is
          logged. See `book-demo.tsx`. */}
      {picked === "demo_booked" && (
        <div className="mt-3">
          <BookDemoFields
            lead={lead}
            calBookingUrl={calBookingUrl}
            email={email}
            onEmail={setEmail}
            contact={contact}
            onContact={setContact}
            hint="Book the slot you agreed, then come back and log the call."
          />
        </div>
      )}

      {picked === "callback" && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="callback-at">
            {callbackZoneLabel(lead.tz, readerTz)}
          </Label>
          <Input
            id="callback-at"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Didn&rsquo;t connect
          </p>
          {KEEP.map((o) => (
            <Button
              key={o}
              variant={picked === o ? "default" : "outline"}
              className="w-full justify-start"
              disabled={saving}
              onClick={() => setPicked(picked === o ? null : o)}
            >
              {OUTCOME_LABELS[o]}
            </Button>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Done with them
          </p>
          {CLOSE.map((o) => (
            <Button
              key={o}
              // Picked reads as filled, unpicked as the outline of what it
              // would become, so the two columns still read differently.
              variant={
                picked === o
                  ? o === "demo_booked"
                    ? "default"
                    : "destructive"
                  : "outline"
              }
              className={cn(
                "w-full justify-start",
                picked !== o &&
                  o !== "demo_booked" &&
                  "border-destructive/40 text-destructive hover:text-destructive",
              )}
              disabled={saving}
              onClick={() => setPicked(picked === o ? null : o)}
            >
              {OUTCOME_LABELS[o]}
            </Button>
          ))}
        </div>
      </div>

      {/* Nothing is written until this is pressed. Tapping an outcome only
          selects it, so a mis-tap is undone by tapping another — or the same
          one again — rather than by correcting a logged call afterwards. */}
      <Button
        className="mt-4 h-12 w-full text-[15px]"
        disabled={!picked || saving}
        onClick={save}
      >
        <Check data-icon="inline-start" />
        {saving
          ? "Saving…"
          : picked
            ? `Log ${OUTCOME_LABELS[picked].toLowerCase()}`
            : "Pick an outcome to log"}
      </Button>

      {/* Said rather than simply greyed out: a disabled button with no reason
          reads as the screen being broken, which is the lesson the missing
          dial button taught the day before this. */}
      {rang ? (
        <p className="mt-3 text-center text-[12px] text-muted-foreground">
          You rang this one. Pick what happened above to move on —{" "}
          <span className="font-semibold">No answer</span> counts.
        </p>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full"
          disabled={saving}
          onClick={onSkip}
        >
          <SkipForward data-icon="inline-start" />
          Skip without logging
        </Button>
      )}
    </>
  );
}

export function Dialler({
  leads,
  readerTz,
  focusLeadId = null,
  script,
  objections,
  calBookingUrl,
  canDialFromBrowser = false,
  lines = [],
  truncated = false,
  readOnly = false,
  callerName,
  hiddenByHours = 0,
  hiddenByAlwaysOpen = 0,
  showAllHref,
  retryLater = 0,
  liveHints = false,
  market = null,
  panelLeft: initialPanel = "objections",
}: {
  leads: QueueLead[];
  /** The clock this caller reads the app in, from the picker at the top of
   *  Stats. Only reached for a lead whose number belongs to no place. */
  readerTz: string;
  /** A lead to open on, from a `?lead=` link — Missed calls and the callbacks
   *  diary both point here so the ring back can be placed and logged in the
   *  one place. It only seeds the first card; working it hands the queue back
   *  to its own order. */
  focusLeadId?: number | null;
  /** The caller's own script and objection sheet, already rendered. One
   *  market, decided by who is signed in rather than by the lead, so nothing
   *  switches while a call is in progress. */
  script?: SopSection[];
  objections?: SopSection[];
  /** Where a demo gets booked. Read from the environment on the server, so
   *  changing it is a variable rather than a deploy, and unset simply means no
   *  button. */
  calBookingUrl?: string;
  /** False when this caller works from their own phone, which is a real
   *  choice rather than a missing setup: they get no dial button and, more
   *  to the point, no line explaining its absence. */
  canDialFromBrowser?: boolean;
  /** Labelled numbers on the account that belong to nobody: the demo line and
   *  its like, offered by name when adding somebody to a live call. Empty
   *  means no "Add call" button, there being nothing on this card to type a
   *  number into. */
  lines?: SavedLine[];
  /** More leads match this view than were loaded — said out loud, because a
   *  tab labelled "All" showing part of a list is a lie. */
  truncated?: boolean;
  /** Closed view: these calls are finished, there is nothing to log. */
  readOnly?: boolean;
  /** Who is signed in, for the booking post they owe Slack. Absent means no
   *  prompt, since a post has to be signed by somebody. */
  callerName?: string;
  /** Leads in this view that "Open now" is holding back, and where to go to
   *  see them. Zero means the filter is off or hiding nothing. Needed because
   *  the filter is on by default: an empty queue then means "everyone is
   *  asleep", and "Nothing to call here" would be a lie on a full list. */
  hiddenByHours?: number;
  showAllHref?: string;
  /** Leads rung and not reached that are waiting for a later day. Zero outside
   *  the To call view. Lets an empty queue say "back on a later day" rather
   *  than "Nothing to call here" on a list with calls still owed. */
  retryLater?: number;
  /** How many leads this caller's own "No 24/7" switch is keeping out of the
   *  queue. Only ever leads that are open right now, so an empty queue with
   *  any of these can say so and offer the tap that undoes it. */
  hiddenByAlwaysOpen?: number;
  /** Listen to the live call and suggest which objection fits. Off unless
   *  `LIVE_HINTS=1` and an OpenAI key are set, in which case the dialler
   *  behaves exactly as it does today. */
  liveHints?: boolean;
  /** Which market's sheet is on screen. Sent with a hint request because the
   *  page falls back to the list's market for anyone with none of their own,
   *  so the server cannot work it out from the signed-in user alone. */
  market?: string | null;
  /** Which document holds the left column. The other is on "o". */
  panelLeft?: "objections" | "script";
  /** Demo workspace: the flow works, nothing is written. */
}) {
  const router = useRouter();
  // Worked leads drop out of the local queue immediately so the next number is
  // always one tap away; the server list refreshes underneath.
  const [done, setDone] = React.useState<Set<number>>(new Set());
  const [skipped, setSkipped] = React.useState<number[]>([]);

  // A lead picked out of the list below jumps the queue. Cleared as soon as it
  // is worked, so the order resumes where it was.
  //
  // Seeded from `?lead=` so a link out of Missed calls or the callbacks diary
  // lands on that lead's card rather than on whatever happens to be first.
  // Initial state only, deliberately: once it is worked the queue is the
  // queue again, and re-reading the URL would drag the caller back to a lead
  // they have finished with.
  // The phone itself, from the layout rather than from this screen. That is
  // what stops leaving the dialler — to log a callback, to read the notes —
  // hanging up on the person being spoken to.
  //
  // Claimed so the layout's own call bar stands down while the dial card is
  // showing. That flag no longer decides who *holds* the line, there being one:
  // only who draws it, which is what stops one call being offered twice.
  useClaimLine(canDialFromBrowser);
  const { line, activeLeadId } = useCallLine();

  // A call already up wins over the `?lead=` link: if somebody is mid-call and
  // has navigated back here, the card they need is the one they are talking to.
  const [pickedId, setPickedId] = React.useState<number | null>(
    activeLeadId ?? focusLeadId,
  );

  // Owned here rather than by the lead card, so the drawer outlives a change
  // of lead — and, once dialling is in the browser, an active call.
  const [objectionsOpen, setObjectionsOpen] = React.useState(false);
  const [scriptOpen, setScriptOpen] = React.useState(false);
  // Which document is in the column, and which is therefore on "o". Held here
  // rather than read on every render so the swap is instant; the write to the
  // account is best effort, exactly as the timezone picker's is — a preference
  // that fails to save costs the next page load and nothing else.
  const [panelLeft, setPanelLeft] = React.useState(initialPanel);
  const swapPanel = React.useCallback(() => {
    setPanelLeft((v) => {
      const next = v === "objections" ? "script" : "objections";
      fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panelLeft: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  // Held here for the same reason the line is: `DialControls` is keyed on
  // whether a call is up and `CallForm` is keyed per lead, so either would
  // tear the transcript down in the middle of a call.
  const hints = useObjectionHints({
    enabled: liveHints && canDialFromBrowser,
    callActive: line.state === "active",
    remoteStream: line.remoteStream,
    // The dialler falls back to the list's market for anyone who has none of
    // their own, so the server cannot work it out from the user alone.
    market,
  });

  const remaining = React.useMemo(
    () => leads.filter((l) => !done.has(l.id) && !skipped.includes(l.id)),
    [leads, done, skipped],
  );
  const current =
    remaining.find((l) => l.id === pickedId) ?? remaining[0] ?? null;
  // Every lead still to work, not the first handful: "All" that showed six of
  // forty was the complaint, and a queue you cannot see the end of is worse
  // than a long list.
  const upNext = remaining.filter((l) => l.id !== current?.id);

  // The booking just logged, until the caller says they have posted it. Held
  // here rather than in the lead card so it outlives moving on to the next
  // number: the post is written after the Cal.com tab, by which time the card
  // that prompted it would be three leads ago.
  const [toPost, setToPost] = React.useState<string | null>(null);

  const column = React.useRef<HTMLDivElement>(null);
  /**
   * Back to the top of the card.
   *
   * Not `window.scrollTo`. `PageShell` gives the page its own `overflow-auto`
   * div and the window itself never scrolls, so a call naming the window is
   * silently a no-op: "Up next" had one and had quietly stopped scrolling
   * anywhere. Asking the element to bring itself into view lets the browser
   * find the scroller rather than this guessing which one it is.
   */
  const backToTop = React.useCallback(() => {
    column.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function handleLogged(lead: QueueLead, outcome: CallOutcome) {
    line.reset();
    // The suggestion queue outlives the hangup on purpose — a caller writes
    // notes and picks an outcome after the call, which is exactly when they
    // want to see what came up. This is where it ends: the lead is done.
    hints.clear();
    setDone((prev) => new Set(prev).add(lead.id));
    setPickedId(null);
    if (outcome === "demo_booked" && callerName) {
      setToPost(lead.company ?? lead.name ?? lead.phone);
      // The outcome buttons sit most of a screen below the top of the card, so
      // logging one leaves the reader scrolled past where the prompt appears.
      // A reminder nobody scrolls back up to is not a reminder.
      backToTop();
    }
    // `done` keeps the lead out of the queue locally; the refresh then makes
    // the server agree, so it cannot reappear on the next navigation.
    router.refresh();
  }

  // Rendered above the card and in the empty state both. A demo booked on the
  // last lead in the queue is exactly when this matters most, and that is the
  // one path where there is no card left to sit above.
  const bookingPost =
    toPost && callerName ? (
      <BookingPostCard
        name={callerName}
        lead={toPost}
        onDismiss={() => setToPost(null)}
      />
    ) : null;

  const sections = objections ?? [];
  const scriptSections = script ?? [];

  // Which family the panel lights up — never a single entry. Picking one of
  // seven categories is a much easier problem than one of nineteen entries, and
  // a wrong family costs a glance at three rows rather than a caller reading
  // out a scripted answer to an objection nobody raised.
  const panelHit = hints.hint?.category ?? null;
  // The column holds one document and "o" opens the other, so the pair always
  // covers both and neither is ever unreachable.
  const panelSections = panelLeft === "script" ? scriptSections : sections;
  const drawerIsScript = panelLeft === "objections";

  // When the objections are behind the key rather than in the column, an answer
  // has nowhere to land, so the drawer is opened for them. Only on a new answer
  // — reopening it after they closed it would be the tool arguing with them.
  const lastAnswer = React.useRef<string | null>(null);
  React.useEffect(() => {
    const key = hints.hint ? `${hints.hint.heard}|${hints.hint.title}` : null;
    if (key && key !== lastAnswer.current && !drawerIsScript) setObjectionsOpen(true);
    lastAnswer.current = key;
  }, [hints.hint, drawerIsScript]);

  // One key opens the script. It used to open the objection sheet; the
  // objections now sit permanently beside the card, so the key was pointing at
  // the one thing already on screen and the script was the thing behind a tap.
  // Ignored while typing, or the notes field would swallow every "o" written.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "o" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (drawerIsScript) {
        if (scriptSections.length > 0) setScriptOpen((v) => !v);
      } else if (sections.length > 0) {
        setObjectionsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerIsScript, scriptSections.length, sections.length]);

  // The script and the objections, above the lead card rather than buried in it.
  //
  // They were near the bottom of the card, under the number, the website, the
  // email and the qualification checklist — which on a phone is a scroll away
  // from anything, and on an empty queue was nowhere at all, because that state
  // returns before the card and before the drawers with it. A caller whose
  // queue is empty because everyone in the niche is asleep still wants to read
  // the script.
  //
  // Side by side because they are a pair, and the one already open in the
  // column beside the card needs no button on a wide screen.
  // Above everything, in both returns: a call rings for seconds and an empty
  // queue is exactly when somebody is most likely to be looking elsewhere.
  const ringing = line.incoming ? (
    <IncomingCall
      key={line.incoming.from}
      incoming={line.incoming}
      busy={line.state !== "idle"}
    />
  ) : null;

  const docs =
    scriptSections.length > 0 || sections.length > 0 ? (
      <div className="mb-3 flex gap-2">
        {scriptSections.length > 0 && (
          <Button
            variant="outline"
            className={cn("h-10 flex-1", !drawerIsScript && "xl:hidden")}
            onClick={() => setScriptOpen(true)}
          >
            <ScrollText data-icon="inline-start" />
            Script
          </Button>
        )}
        {sections.length > 0 && (
          <Button
            variant="outline"
            className={cn("h-10 flex-1", drawerIsScript && "xl:hidden")}
            onClick={() => setObjectionsOpen(true)}
          >
            <MessageSquareWarning data-icon="inline-start" />
            Objections
          </Button>
        )}
      </div>
    ) : null;

  // Rendered by both returns. Portalled, so where they sit in the tree does not
  // matter — but being absent from the empty state did.
  const drawers = (
    <>
      <ObjectionDrawer
        open={objectionsOpen}
        onOpenChange={setObjectionsOpen}
        sections={sections}
        // Carried in whichever side the objections are on, so swapping the
        // column changes where the answer appears and not whether it does.
        highlight={panelHit}
        exact={hints.hint?.title ?? null}
        heard={hints.hint?.heard ?? null}
      />
      <ScriptDrawer
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        sections={scriptSections}
      />
    </>
  );

  if (!current) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
        {bookingPost}
        {ringing}
        {docs}
        {drawers}
        <div className="py-11 text-center">
        {/* Three different empty queues, and telling them apart is the whole
            job of this block. "Nothing to call here" on a list of two hundred
            people who happen to be asleep is a lie, and it is the one a caller
            would act on by closing the niche. */}
        <p className="text-sm font-semibold">
          {leads.length === 0
            ? // Ahead of the hours message on purpose: `hiddenByAlwaysOpen`
              // counts only leads that are open right now, so if there are
              // any, the switch is what emptied this and a tap brings them
              // straight back. "Everyone here is closed" would be false.
              hiddenByAlwaysOpen > 0
              ? "Everyone left here is open 24 hours."
              : hiddenByHours > 0
                ? "Everyone here is closed right now."
                : retryLater > 0
                  ? "You've rung everyone you can today."
                  : "Nothing to call here."
            : "Queue cleared."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {leads.length === 0
            ? hiddenByAlwaysOpen > 0
              ? `You asked to hide businesses open 24 hours, and that is all ${hiddenByAlwaysOpen.toLocaleString()} of the ones left. Tap No 24/7 at the top to put them back, or work another niche.`
              : hiddenByHours > 0
              ? `It is outside ${CALLING_HOURS_LABEL} for all ${hiddenByHours.toLocaleString()} of them. Come back later, or work another niche.`
              : retryLater > 0
                ? // A fourth empty queue: the leads are all waiting for their next
                  // try. "Import a CSV" here would send a caller to ask for a new
                  // list when this one has calls owed tomorrow.
                  // "Come back tomorrow" until 2026-09-16, when the shortest
                  // wait in RETRY_AFTER_DAYS went from one day to three: a
                  // caller told to return tomorrow and finding the same empty
                  // queue reads the list as broken. This queue is finished for
                  // now, and the words have to say so.
                  `This niche is done for now. ${retryLater.toLocaleString()} ${retryLater === 1 ? "lead didn't" : "leads didn't"} pick up and ${retryLater === 1 ? "comes" : "come"} back in a few days. Work another niche in the meantime.`
                : "Import a CSV with a phone column to start."
            : "Every lead in this view has been worked."}
        </p>
        {leads.length === 0 && hiddenByHours > 0 && showAllHref && (
          // Never hidden behind a confirmation: ringing outside business hours
          // is a judgement, not a rule, and a callback promised for 8am their
          // time is a good reason to walk past this.
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={showAllHref}>
              <Clock data-icon="inline-start" />
              Show them anyway
            </Link>
          </Button>
        )}
        {skipped.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setSkipped([])}
          >
            <Undo2 data-icon="inline-start" />
            Bring back {skipped.length} skipped
          </Button>
        )}
        </div>
      </div>
    );
  }

  return (
    // Two columns once there is room for them: the script sits in the space
    // that was empty to the left of the card, and the card keeps its own
    // width rather than stretching to fill a wider screen. Below `xl` the
    // script becomes a drawer — see the button on the card.
    <div
      className={cn(
        "mx-auto w-full px-4 py-5 sm:px-6",
        panelSections.length > 0
          ? "max-w-2xl xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,24rem)_minmax(0,42rem)] xl:justify-center xl:gap-6"
          : "max-w-2xl",
      )}
    >
      {panelSections.length > 0 && (
        // Objections took the script's column on purpose. The script is read
        // top to bottom and is much the same every call, so it can live behind
        // a tap; the objections are the part a caller has to know, and they
        // were the part hidden in a drawer. The live hint highlights a row in
        // here rather than printing its own card — pointing at a list they can
        // see all of teaches where things are, and a card teaches nothing.
        <aside className="hidden xl:block">
          <ObjectionPanel
            sections={panelSections}
            kind={panelLeft}
            onSwap={scriptSections.length > 0 ? swapPanel : undefined}
            highlight={panelLeft === "objections" ? panelHit : null}
            exact={panelLeft === "objections" ? (hints.hint?.title ?? null) : null}
            heard={panelLeft === "objections" ? (hints.hint?.heard ?? null) : null}
          />
        </aside>
      )}

      <div ref={column} className="min-w-0">
      {bookingPost}
      {ringing}
      {docs}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tracking-[-0.01em]">
              {current.company ?? current.name ?? current.phone}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {[current.name, current.title].filter(Boolean).join(" · ") ||
                "No contact name"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {current.attempts > 0 && (
              <Badge variant="secondary">
                {current.attempts} {current.attempts === 1 ? "try" : "tries"}
              </Badge>
            )}
            <Badge variant="outline">{remaining.length} left</Badge>
          </div>
        </div>

        {current.lastOutcome && (
          <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            <span className="font-semibold">
              Last: {OUTCOME_LABELS[current.lastOutcome]}
            </span>
            {current.lastCalledAt && (
              // Clock-derived, so server and client can disagree by a minute
              // across a rounding boundary — see the board for the same note.
              <span suppressHydrationWarning className="text-muted-foreground">
                {" "}
                · {relative(current.lastCalledAt)}
              </span>
            )}
            {current.lastNotes && (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {current.lastNotes}
              </p>
            )}
          </div>
        )}

        {/* One message per business, ever. This is its own line rather than
            part of "Last:" above, because by the time a lead comes back round
            the latest call is usually the no answer that followed the message
            — so the fact the caller needs is not in the latest call at all.
            Worded as the instruction rather than the fact: a caller mid-queue
            reads a date and has to work out what to do with it. */}
        {current.voicemailAt && (
          <p
            suppressHydrationWarning
            className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span className="font-semibold">
              You already left a voicemail {relative(current.voicemailAt)}
            </span>{" "}
            Do not leave another one. If nobody picks up, hang up and log it as
            Voicemail.
          </p>
        )}

        {/* Keys are prefixed because this and CallForm below are siblings:
            keying both on the bare lead id gave one parent two children with
            the same key, which React is entitled to conflate. */}
        {/* Keyed on whether a call is up, so the "Add call" list cannot be
            left open from the last one. It holds no call state of its own —
            the line lives in the parent — so remounting costs nothing. */}
        <DialControls
          key={line.state === "idle" ? "idle" : "on-call"}
          lead={current}
          line={line}
          enabled={canDialFromBrowser}
          lines={lines}
        />
        <CopyNumber
          key={`number-${current.id}`}
          phone={current.phone}
          blocked={current.dncBlock}
        />
        {/* Directly under the number, because these are the last two things
            checked before ringing it: where they are and what time it is
            there. One row, since they answer the same question — and both
            render independently, because a toll-free number has a known
            address and no zone, while a mobile has a zone and often no
            address. */}
        <div className="mt-1.5 flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px] font-semibold">
          {placeLabel(current) && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <MapPin className="size-3.5 shrink-0" strokeWidth={2.2} />
              {placeLabel(current)}
            </span>
          )}
          {placeLabel(current) && current.tz && (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          )}
          <LocalTime tz={current.tz} hoursToday={current.hoursToday} withZone />
        </div>
        {/* Sizing a business up before dialling — is this one van or forty —
            is the question the number cannot answer. A new tab rather than
            the same one: leaving this page loses the queue's position. */}
        {websiteHref(current.website) && (
          <a
            href={websiteHref(current.website)!}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-background text-sm font-bold text-foreground transition-colors hover:bg-muted"
          >
            <Globe className="size-4 shrink-0" strokeWidth={2.2} />
            <span className="truncate">{websiteLabel(current.website)}</span>
            <ExternalLink
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2.2}
            />
          </a>
        )}
        {current.email && (
          <p className="mt-2 truncate text-center text-xs text-muted-foreground">
            {current.email}
          </p>
        )}

        <HowToBook />

        {liveHints && sections.length > 0 && (
          // Shown whenever the feature is on rather than only mid-call: it
          // appeared only once a call was up, so an idle screen showed no
          // button at all and read as the feature being missing.
          //
          // Pressed when the prospect raises something, not once per call.
          // Spotting an objection is the caller's job; this only saves them
          // hunting for which section covers it. Nothing has left the browser
          // before this — the audio sits in a ten-second buffer.
          <div className="mt-3">
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={hints.ask}
              disabled={hints.asking}
            >
              <Ear data-icon="inline-start" />
              {hints.asking ? "Checking…" : "What did they just say?"}
            </Button>
            {hints.hint || hints.problem ? (
              <div className="mt-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5">
                {hints.hint?.heard ? (
                  <p className="truncate text-[11px] italic text-muted-foreground">
                    heard: “{hints.hint.heard}”
                  </p>
                ) : null}
                {hints.problem ? (
                  <p className="text-[11px] text-muted-foreground">{hints.problem}</p>
                ) : (
                  <p className="text-[11px] font-semibold xl:hidden">
                    {hints.hint?.title ?? hints.hint?.category} — open Objection
                    handling
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}

        {!readOnly && (
          // Keyed on the lead so moving to the next number remounts the form:
          // notes and the callback picker reset by construction rather than by
          // an effect that clears them after the fact.
          <CallForm
            readerTz={readerTz}
            key={`form-${current.id}`}
            lead={current}
            onLogged={(outcome) => handleLogged(current, outcome)}
            calBookingUrl={calBookingUrl}
            line={line}
            onSkip={() => {
              setSkipped((prev) => [...prev, current.id]);
              setPickedId(null);
            }}
          />
        )}
      </div>

      {upNext.length > 0 && (
        <div className="mt-5">
          <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            Up next
            <span className="ml-1.5 tabular-nums opacity-70">
              {upNext.length}
            </span>
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {upNext.map((l) => (
              <li key={l.id}>
                {/* Tapping a row dials that one next. Without it the only way
                    to reach the fortieth lead was to skip thirty-nine. */}
                <button
                  type="button"
                  onClick={() => {
                    setPickedId(l.id);
                    backToTop();
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-muted/50"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">
                      {l.company ?? l.name ?? l.phone}
                    </span>
                    {/* The state under the name rather than beside the number:
                        a caller scanning the queue is choosing who to ring
                        next, and "Alaska" at 9am their time is the whole
                        decision. Dropped entirely when unknown — see
                        `QueueLead.state`. */}
                    {placeShort(l) && (
                      <span className="truncate text-[11px] font-medium text-muted-foreground">
                        {placeShort(l)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {l.phone}
                  </span>
                  {l.lastOutcome && (
                    <Badge
                      variant={outcomeTone(l.lastOutcome)}
                      className={cn("shrink-0")}
                    >
                      {OUTCOME_LABELS[l.lastOutcome]}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="px-1 pt-2 text-[12px] text-muted-foreground">
              Showing the first {leads.length.toLocaleString()} of this view.
              The spreadsheet holds the rest.
            </p>
          )}
        </div>
      )}

      </div>

      {/* Mounted by the dialler, not by the lead card. Both render through a
          portal, so the DOM node moves but this tree does not — opening one
          cannot unmount the dialler, and once dialling happens in the browser
          that is what stops it dropping a live call. */}
      {drawers}
      {/* The far end's audio has to land somewhere. One element for the whole
          dialler, never inside the lead card, which remounts per number. */}
    </div>
  );
}
