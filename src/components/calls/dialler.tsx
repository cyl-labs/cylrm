"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  CalendarPlus,
  MessageSquareWarning,
  ScrollText,
  ShieldAlert,
  SkipForward,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type { CallOutcome, QueueLead } from "@/lib/calls";
import type { SopSection } from "@/lib/sop";
import { ObjectionDrawer } from "@/components/sop/objection-drawer";
import { ScriptPanel } from "@/components/sop/script-panel";
import { ScriptDrawer } from "@/components/sop/script-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OUTCOME_LABELS, outcomeTone } from "@/components/calls/outcome";
import { dialableNumber } from "@/lib/phone";
import { websiteHref, websiteLabel } from "@/lib/website";
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
 * What counts as a booked meeting.
 *
 * On the card rather than behind a tap: it is the test every call is measured
 * against and the thing a caller is paid on, so it should never be something
 * anyone has to go and look up.
 *
 * Every box is answered by a question the script actually asks — the first two
 * were added to section 03 for exactly this reason. A bar the script cannot
 * reach does not raise quality, it just moves the argument to payday, which is
 * also why "showed some interest" is not on this list: it is a judgment made
 * by the person paying, after the work is done. Agreeing to a specific time is
 * the interest signal, and it is checkable by both sides.
 *
 * Hard-coded rather than a document, so what earns a caller their fee cannot
 * be scrolled past or edited by accident.
 */
function QualificationCriteria() {
  const CRITERIA = [
    "Owner, or bringing whoever decides",
    "Misses 5+ calls a week",
    "Agreed a specific day and time",
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
}: {
  lead: QueueLead;
  onLogged: () => void;
  onSkip: () => void;
  calBookingUrl?: string;
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
      onLogged();
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
  truncated = false,
  readOnly = false,
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
  /** More leads match this view than were loaded — said out loud, because a
   *  tab labelled "All" showing part of a list is a lie. */
  truncated?: boolean;
  /** Closed view: these calls are finished, there is nothing to log. */
  readOnly?: boolean;
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

  function handleLogged(leadId: number) {
    setDone((prev) => new Set(prev).add(leadId));
    setPickedId(null);
    // `done` keeps the lead out of the queue locally; the refresh then makes
    // the server agree, so it cannot reappear on the next navigation.
    router.refresh();
  }

  const sections = objections ?? [];
  const scriptSections = script ?? [];

  // One key opens the sheet. Ignored while typing, or the notes field would
  // swallow every "o" a caller writes.
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
      setObjectionsOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!current) {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold">
          {leads.length === 0 ? "Nothing to call here." : "Queue cleared."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {leads.length === 0
            ? "Import a CSV with a phone column to start."
            : "Every lead in this view has been worked."}
        </p>
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
        scriptSections.length > 0
          ? "max-w-2xl xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,22rem)_minmax(0,42rem)] xl:justify-center xl:gap-6"
          : "max-w-2xl",
      )}
    >
      {scriptSections.length > 0 && (
        <aside className="hidden xl:block">
          <ScriptPanel sections={scriptSections} />
        </aside>
      )}

      <div className="min-w-0">
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
        <CopyNumber
          key={`number-${current.id}`}
          phone={current.phone}
          blocked={current.dncBlock}
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
          // Only where the side panel cannot fit. On a wide screen the script
          // is already open beside this card and a button to open it again
          // would be a second way to reach the same words.
          <Button
            variant="outline"
            className="mt-3 h-11 w-full xl:hidden"
            onClick={() => setScriptOpen(true)}
          >
            <ScrollText data-icon="inline-start" />
            Script
          </Button>
        )}

        {sections.length > 0 && (
          // Beside the number rather than in the header: it is reached in the
          // middle of a sentence, with one hand, while someone is talking.
          <Button
            variant="outline"
            className="mt-3 h-11 w-full"
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
            onLogged={() => handleLogged(current.id)}
            calBookingUrl={calBookingUrl}
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
                    window.scrollTo({ top: 0, behavior: "smooth" });
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
      <ScriptDrawer
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        sections={scriptSections}
      />
    </div>
  );
}
