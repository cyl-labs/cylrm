"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  CalendarPlus,
  Grid3x3,
  Mic,
  MicOff,
  MessageSquareWarning,
  Ear,
  PhoneCall,
  PhoneOff,
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
import { useObjectionHints } from "@/components/calls/use-objection-hints";
import {
  useTelnyxCall,
  type TelnyxLine,
} from "@/components/calls/use-telnyx-call";
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
import { LEAD_HOURS_LABEL } from "@/lib/call-hours";
import { websiteHref, websiteLabel } from "@/lib/website";
import { LocalTime } from "@/components/calls/local-time";
import { callTzDate } from "@/lib/call-time";
import { cn } from "@/lib/utils";

/**
 * Left column keeps the lead in the queue, right column closes it out.
 *
 * Only the outcomes a cold call can actually end in. Trial, won and lost come
 * days or weeks later and are set from the board or the spreadsheet — putting
 * them here would mean six buttons on a phone for things that never happen
 * while the phone is at your ear.
 */
const REMOTE_AUDIO_ID = "cylrm-remote-audio";
const SECOND_AUDIO_ID = "cylrm-second-audio";

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

  // Nothing at all, not even the fallback line. Telling someone who always
  // dials from their own phone that there is "no caller ID yet" is an apology
  // for a missing setup, when they are already working exactly as intended.
  if (!enabled) return null;
  const busy = line.state !== "idle";
  const blocked =
    lead.dncBlock ??
    (!lead.dialTo
      ? "This number cannot be dialled from here"
      : !lead.dialFrom
        ? `No caller ID for ${lead.phone.startsWith("+44") ? "UK" : lead.phone.startsWith("+1") ? "US" : "these"} numbers yet`
        : null);

  if (line.problem || (!line.ready && !busy)) return null;
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
      <Button
        className="mt-2 h-12 w-full text-[15px]"
        onClick={() => line.dial(lead.dialTo!, lead.dialFrom!)}
      >
        <PhoneCall data-icon="inline-start" />
        Call
      </Button>
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
 * What counts as a booked meeting.
 *
 * On the card rather than behind a tap: it is the test every call is measured
 * against and the thing a caller is paid on, so it should never be something
 * anyone has to go and look up.
 *
 * Every box is answered by a question the script actually asks — the first two
 * were added to section 03 for exactly this reason. A bar the script cannot
 * reach does not raise quality, it just moves the argument to payday.
 *
 * A missed-calls threshold was on this list and came off: it made the caller
 * interrogate a prospect who had already agreed to meet, and a number nobody
 * verifies is not a qualification. Interest replaced it, judged on the call
 * and paired with a specific date and time — the part both sides can check.
 *
 * Hard-coded rather than a document, so what earns a caller their fee cannot
 * be scrolled past or edited by accident.
 */
function QualificationCriteria() {
  const CRITERIA = [
    "Owner or decision maker",
    "Interested",
    "Agreed a specific date and time",
  ];
  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-3.5 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        Counts as booked
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {CRITERIA.map((c) => (
          <li
            key={c}
            className="flex gap-2 text-[13px] leading-snug text-muted-foreground"
          >
            {/* A printed box, not a control: nothing is stored and there is
                nothing to tap while agreeing a time. The outcome button is
                already the record that a meeting was booked. */}
            <span aria-hidden className="text-muted-foreground/70">
              &#9744;
            </span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
      {/* The criteria say whether it counts; this says how to finish it. Both
          on the card because both are needed in the same thirty seconds, while
          someone is still on the phone. */}
      <p className="mt-2.5 border-t pt-2 text-[12px] leading-snug text-muted-foreground">
        Before you hang up: get their email, confirm the day and time, then log
        it as <span className="font-bold">Demo booked</span>.
      </p>
    </div>
  );
}

/**
 * Tomorrow at 10am Singapore time.
 *
 * Built from the Singapore date rather than the browser's, because the server
 * reads whatever this field holds as Singapore time — the two have to mean the
 * same thing, or the default alone would shift the appointment.
 */
function defaultCallbackAt() {
  const sgToday = new Date(`${callTzDate()}T00:00:00Z`);
  sgToday.setUTCDate(sgToday.getUTCDate() + 1);
  return `${sgToday.toISOString().slice(0, 10)}T10:00`;
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
  onLogged,
  onSkip,
  calBookingUrl,
  line,
}: {
  lead: QueueLead;
  /** Handed the outcome, not just the fact that something was saved: a booking
   *  is the one that owes Slack a post, and only this knows which was logged. */
  onLogged: (outcome: CallOutcome) => void;
  onSkip: () => void;
  calBookingUrl?: string;
  line: TelnyxLine;
}) {
  const [notes, setNotes] = React.useState("");
  // Seeded from the lead so a number that already has them is one glance, not
  // one retype. What the prospect says on the call wins over the scrape.
  const [email, setEmail] = React.useState(lead.email ?? "");
  const [contact, setContact] = React.useState(lead.name ?? "");
  const [callbackAt, setCallbackAt] = React.useState(defaultCallbackAt);
  // Picked but not yet saved. Nothing is written until the confirm button is
  // pressed: one tap next to another used to be the whole gesture, and a
  // mis-tap became a call in the record that had to be found and corrected
  // later.
  const [picked, setPicked] = React.useState<CallOutcome | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
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
          // Present only when the call was placed from here. The session id is
          // what the recording joins on; the duration is this browser's timer.
          telnyxSessionId: line.sessionId ?? undefined,
          durationSeconds: line.seconds || undefined,
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

      {picked === "demo_booked" && (
        <div className="mt-3 space-y-2.5 rounded-lg border bg-muted/30 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            Booking the demo
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="demo-email">Their email</Label>
            <Input
              id="demo-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-contact">Who you spoke to</Label>
            <Input
              id="demo-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Name"
            />
          </div>
          {calBookingUrl && (
            // A new tab, never a navigation: leaving this page unmounts the
            // dialler, which loses the queue's position now and would drop a
            // live call once dialling moves into the browser. Cal.com's own
            // booking flow is what sends the invite and the reminders and
            // writes the event to the calendar, so the caller finishes there.
            <a
              href={`${calBookingUrl}?${new URLSearchParams({
                ...(contact.trim() ? { name: contact.trim() } : {}),
                ...(email.trim() ? { email: email.trim() } : {}),
                notes: `${lead.company ?? lead.phone} (${lead.phone})`,
              }).toString()}`}
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
          <p className="text-[12px] text-muted-foreground">
            Book the slot you agreed, then come back and log the call.
          </p>
        </div>
      )}

      {picked === "callback" && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="callback-at">Call back at (Singapore time)</Label>
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
    </>
  );
}

export function Dialler({
  leads,
  script,
  objections,
  calBookingUrl,
  canDialFromBrowser = false,
  lines = [],
  truncated = false,
  readOnly = false,
  callerName,
  hiddenByHours = 0,
  showAllHref,
  liveHints = false,
}: {
  leads: QueueLead[];
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
  /** Listen to the live call and suggest which objection fits. Off unless
   *  `LIVE_HINTS=1` and an OpenAI key are set, in which case the dialler
   *  behaves exactly as it does today. */
  liveHints?: boolean;
  /** Demo workspace: the flow works, nothing is written. */
}) {
  const router = useRouter();
  // Worked leads drop out of the local queue immediately so the next number is
  // always one tap away; the server list refreshes underneath.
  const [done, setDone] = React.useState<Set<number>>(new Set());
  const [skipped, setSkipped] = React.useState<number[]>([]);

  // A lead picked out of the list below jumps the queue. Cleared as soon as it
  // is worked, so the order resumes where it was.
  const [pickedId, setPickedId] = React.useState<number | null>(null);

  // Owned here rather than by the lead card, so the drawer outlives a change
  // of lead — and, once dialling is in the browser, an active call.
  const [objectionsOpen, setObjectionsOpen] = React.useState(false);
  const [scriptOpen, setScriptOpen] = React.useState(false);
  // One line for the whole session, held here so changing lead or refreshing
  // after an outcome cannot drop a call in progress.
  const line = useTelnyxCall(
    REMOTE_AUDIO_ID,
    canDialFromBrowser,
    SECOND_AUDIO_ID,
  );

  // Held here for the same reason the line is: `DialControls` is keyed on
  // whether a call is up and `CallForm` is keyed per lead, so either would
  // tear the transcript down in the middle of a call.
  const hints = useObjectionHints({
    enabled: liveHints && canDialFromBrowser,
    callActive: line.state === "active",
    remoteStream: line.remoteStream,
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
      if (scriptSections.length > 0) setScriptOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scriptSections.length]);

  if (!current) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
        {bookingPost}
        <div className="py-11 text-center">
        {/* Three different empty queues, and telling them apart is the whole
            job of this block. "Nothing to call here" on a list of two hundred
            people who happen to be asleep is a lie, and it is the one a caller
            would act on by closing the niche. */}
        <p className="text-sm font-semibold">
          {leads.length === 0
            ? hiddenByHours > 0
              ? "Everyone here is asleep."
              : "Nothing to call here."
            : "Queue cleared."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {leads.length === 0
            ? hiddenByHours > 0
              ? `It is outside ${LEAD_HOURS_LABEL} for all ${hiddenByHours.toLocaleString()} of them. Come back later, or work another niche.`
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
        sections.length > 0
          ? "max-w-2xl xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,24rem)_minmax(0,42rem)] xl:justify-center xl:gap-6"
          : "max-w-2xl",
      )}
    >
      {sections.length > 0 && (
        // Objections took the script's column on purpose. The script is read
        // top to bottom and is much the same every call, so it can live behind
        // a tap; the objections are the part a caller has to know, and they
        // were the part hidden in a drawer. The live hint highlights a row in
        // here rather than printing its own card — pointing at a list they can
        // see all of teaches where things are, and a card teaches nothing.
        <aside className="hidden xl:block">
          <ObjectionPanel
            sections={sections}
            highlight={panelHit}
            exact={hints.hint?.title ?? null}
            heard={hints.hint?.heard ?? null}
          />
        </aside>
      )}

      <div ref={column} className="min-w-0">
      {bookingPost}
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
        {/* Directly under the number, because it is the last thing checked
            before ringing it. Renders nothing when the zone is unknown. */}
        <LocalTime
          tz={current.tz}
          withZone
          className="mt-1.5 w-full justify-center text-[13px] font-semibold"
        />
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

        <QualificationCriteria />

        {scriptSections.length > 0 && (
          // At every width now: the column beside this card holds the
          // objections, so this is the only way to the script.
          <Button
            variant="outline"
            className="mt-3 h-11 w-full"
            onClick={() => setScriptOpen(true)}
          >
            <ScrollText data-icon="inline-start" />
            Script
          </Button>
        )}

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

        {sections.length > 0 && (
          // Only below `xl`, where the panel beside this card cannot fit. On a
          // wide screen the list is already open and searchable next to them.
          <Button
            variant="outline"
            className="mt-3 h-11 w-full xl:hidden"
            onClick={() => setObjectionsOpen(true)}
          >
            <MessageSquareWarning data-icon="inline-start" />
            Objection handling
          </Button>
        )}

        {!readOnly && (
          // Keyed on the lead so moving to the next number remounts the form:
          // notes and the callback picker reset by construction rather than by
          // an effect that clears them after the fact.
          <CallForm
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
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {l.company ?? l.name ?? l.phone}
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

      {/* Mounted by the dialler, not by the lead card. It renders through a
          portal, so the DOM node moves but this tree does not — opening it
          cannot unmount the dialler, and once dialling happens in the browser
          that is what stops it dropping a live call. */}
      <ObjectionDrawer
        open={objectionsOpen}
        onOpenChange={setObjectionsOpen}
        sections={sections}
      />
      {/* The far end's audio has to land somewhere. One element for the whole
          dialler, never inside the lead card, which remounts per number. */}
      <audio id={REMOTE_AUDIO_ID} autoPlay />
      <audio id={SECOND_AUDIO_ID} autoPlay />
      <ScriptDrawer
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        sections={scriptSections}
      />
    </div>
  );
}
