"use client";

import * as React from "react";
import {
  Ear,
  BookUser,
  Delete,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyPhone, e164 } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { NumberBook, type KeypadLine } from "./number-book";
import {
  LinePair,
  LineRow,
  MergeControls,
  SavedLineList,
  mmss,
  type SavedLine,
} from "./second-line";
import { PHONE_KEYS } from "./tone-pad";
import { useTelnyxCall } from "./use-telnyx-call";
import { useObjectionHints } from "./use-objection-hints";
import { useClaimLine } from "./line-presence";
import { IncomingCall } from "./incoming-call";
import { ObjectionPanel } from "@/components/sop/objection-panel";
import { ScriptDrawer } from "@/components/sop/script-drawer";
import type { SopSection } from "@/lib/sop";

export type Sheet = {
  key: "us" | "sg";
  label: string;
  script: SopSection[];
  objections: SopSection[];
};

const REMOTE_AUDIO_ID = "keypad-remote-audio";
const SECOND_AUDIO_ID = "keypad-second-audio";

/**
 * Where the outbound voice profile is allowed to send a call.
 *
 * Not a guess: `whitelisted_destinations` on the `cylrm-dialler` profile is
 * SG and US, so a UK number is refused by Telnyx rather than by us. Saying so
 * before the call is placed is the difference between "not set up for the UK"
 * and a dial button that fails for no stated reason.
 */
const DIALLABLE = new Set(["sg", "us"]);

const COUNTRY: Record<string, string> = {
  sg: "Singapore",
  us: "United States",
  gb: "United Kingdom",
};


/** Is the person typing into a real field? Then the keystroke is that field's,
 *  not the pad's. */
function inTextField() {
  const el = document.activeElement;
  const tag = el?.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    Boolean((el as HTMLElement | null)?.isContentEditable)
  );
}

/**
 * The country code's plus, put back when it is missing.
 *
 * Numbers get written down without it constantly — "18009256278" off a
 * website, a number read out over the phone — and on this screen there is no
 * list to read a bare national number against, so what should dial fine sits
 * there refusing to.
 *
 * Never added blindly, which would break more than it fixes: a Singapore local
 * number is eight digits and dials as it stands, and "+88834712" is nothing at
 * all. The rule is that the plus goes on only when the digits already *are* a
 * whole international number — when putting it there adds punctuation and
 * nothing else. Where a country code would have to be invented to make sense
 * of the digits, they are left exactly as typed and the existing rules read
 * them as they always have.
 *
 * That is also what keeps it safe to run on every keystroke. Rewriting a
 * number the moment it parses would mangle one being typed: "65888347" is a
 * complete Singapore local number eight digits in, so a rewrite would turn a
 * half-typed 6588834712 into +6565888347 and then keep appending.
 *
 * The knock-on worth knowing: 1800 + seven digits is both a Singapore
 * toll-free line and a US one, and `classifyPhone` calls that tie for
 * Singapore, which has no dialable form. With the plus it reads as US and
 * dials. That is the right call *here* — a keypad has no market to read a
 * number in, and neither reading could ring before — but it means the hint's
 * country is the thing to check before pressing Call.
 */
function withCountryCode(entry: string): string {
  if (!entry || entry.startsWith("+")) return entry;
  const international = `+${entry}`;
  return e164(international) === international ? international : entry;
}

/**
 * A pasted number, reduced to what a keypad can hold.
 *
 * A number dialled here has almost always been copied from somewhere — a
 * listing, a WhatsApp message, the spreadsheet — and it arrives wearing
 * whatever punctuation that page used: "(907) 659-2550", "+65 8123 4567",
 * "(+65) 8883 4712". `classifyPhone` would see through all of it, but the
 * display would not, and neither would the twenty-character cap.
 *
 * A leading "00" becomes the "+" it stands for. That is how most of the world
 * writes an international prefix, and it is unambiguous: no number that needs
 * keeping starts with two zeroes.
 */
function pastedNumber(text: string): string {
  const trimmed = text.trim();
  const keys = trimmed.replace(/[^\d*#]/g, "");
  if (!keys) return "";
  // Any plus ahead of the first digit is this number's country code marker,
  // not just one at the very front: "(+65) 8883 4712" is how a good half of
  // the listings write it.
  if (/^\D*\+/.test(trimmed)) return `+${keys}`;
  if (keys.startsWith("00")) return `+${keys.slice(2)}`;
  return keys;
}

/**
 * One leg of a keypad call, as it will be filed.
 *
 * Held in a ref and refreshed while the line is up, because the row is written
 * when the call *ends* — the duration and Telnyx's session id are only known
 * then — and by that moment the hook has already cleared the line's state.
 */
type Leg = {
  /** E.164, as dialled. */
  phone: string;
  /** The saved line's name when it was picked off the list, else null. */
  label: string | null;
  /** This is the second leg: a line added to a call already up. */
  addedToCall: boolean;
  sessionId: string | null;
  seconds: number;
};

/**
 * A phone, with no lead behind it.
 *
 * Every other way to place a call in here starts from a `call_lead`, which is
 * right for the work and wrong for testing: checking that the line comes up,
 * that the caller ID is what you bought, or that a number answers meant
 * importing a CSV of invented businesses first, and those leads then sat in
 * the pipeline and the stats being counted as work.
 *
 * So there is still no `call` row, and so no outcome, no lead state, and
 * nothing in the Stats tiles, the board, the Scoreboard or anybody's pickup
 * count. What there is, since 2026-08-28, is a `keypad_call` row per leg: the
 * numbers were never the reason to keep no record at all, and without one
 * nothing could say who rang a number last Tuesday, or reach the recording
 * Telnyx had already saved of it. They surface in one place — the "Every call"
 * table on Stats, marked Keypad — and the screen says so.
 */
export function Keypad({
  did,
  callerName,
  lines,
  book,
  sheets = [],
  liveHints = false,
}: {
  /** The caller ID this person rings from, or null if they have none yet. */
  did: string | null;
  callerName: string;
  /** Labelled numbers on the account that belong to nobody: demo lines and
   *  client lines, offered by name when adding somebody to a call. */
  lines: SavedLine[];
  /** What this person can put into the pad without typing it: the labelled
   *  lines if they are a founder, their own account's plain numbers if they
   *  work every market. Empty for a caller with one market, who has one number
   *  and nothing to choose between — they get the pad exactly as it was. */
  book: KeypadLine[];
  /** The market sheets this person may see: one for a caller assigned a
   *  market, both for anyone with none. More than one puts a picker on screen;
   *  a caller with one market never sees a control, having nothing to choose. */
  sheets?: Sheet[];
  /** Whether the "what did they just say?" button exists at all. */
  liveHints?: boolean;
}) {
  const [typed, setTyped] = React.useState("");
  // The book of numbers, and what was last taken out of it. The pick is kept
  // as a whole line rather than a flag so the hint can say what was chosen —
  // and compared against what is in the pad, which is what makes it fall away
  // by itself the moment a digit is typed or deleted.
  const [bookOpen, setBookOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<KeypadLine | null>(null);
  // Tones pressed during a call, kept apart from the number so pressing 2 to
  // reach a department does not rewrite what you dialled.
  const [tones, setTones] = React.useState("");
  // Adding somebody: the pad goes back to entering a number, this time for a
  // second call placed alongside the one already up.
  const [adding, setAdding] = React.useState(false);
  const [secondTyped, setSecondTyped] = React.useState("");
  // What the second line is called once it is dialled — the number, or the
  // label when it was picked off the list. Kept apart from the entry buffer so
  // the row can read "pxn junk removal" rather than eleven digits.
  const [secondName, setSecondName] = React.useState("");

  const line = useTelnyxCall(REMOTE_AUDIO_ID, Boolean(did), SECOND_AUDIO_ID);

  // The same help the dialler has. There is no lead here, so nothing is logged
  // and nothing is scored — but a demo line answers with the same objections a
  // prospect does, and this is where those get practised.
  // As on the dialler: the app-wide listener stands down while this screen
  // holds a line of its own.
  useClaimLine(Boolean(did));

  const [scriptOpen, setScriptOpen] = React.useState(false);
  const [market, setMarket] = React.useState(sheets[0]?.key);
  const sheet = sheets.find((s) => s.key === market) ?? sheets[0];
  const objections = sheet?.objections ?? [];
  const script = sheet?.script ?? [];

  const hints = useObjectionHints({
    enabled: liveHints && objections.length > 0,
    callActive: line.state === "active",
    remoteStream: line.remoteStream,
    // The panel may be showing a market the server would not have chosen: an
    // account with no market of its own picks one here.
    market: sheet?.key ?? null,
  });
  const busy = line.state !== "idle";
  const two = line.second !== null;

  // One entry field, two possible numbers behind it. Everything that judges a
  // number — the country, whether it is complete, whether outbound is switched
  // on for it — then reads the same way for the first call and the second.
  const entry = adding ? secondTyped : typed;
  const setEntry = adding ? setSecondTyped : setTyped;
  // Typing edits the number when there is a number to edit — idle, or partway
  // through adding a second call. A connected call turns the pad into a tone
  // pad, so the field goes read-only rather than disappearing.
  const editable = !busy || adding;
  const entryRef = React.useRef<HTMLInputElement | null>(null);
  const kind = entry ? classifyPhone(entry) : "missing";
  const target = e164(entry);
  const diallable = Boolean(target) && DIALLABLE.has(kind);
  const canDial = Boolean(did) && line.ready && !busy && diallable;
  const canAdd = adding && line.state === "active" && !two && diallable;

  // The pick only counts while the pad still holds exactly what it put there.
  // Typing a digit, a backspace or a paste makes it somebody else's number
  // again, and no setter has to remember to say so.
  const chosen = picked && picked.phoneNumber === typed ? picked : null;

  // What each line is carrying, kept up to date while it is up so that the row
  // can still be written a beat after it has gone.
  const firstLeg = React.useRef<Leg | null>(null);
  const secondLeg = React.useRef<Leg | null>(null);

  // File a leg and forget it. Best-effort, like the presence heartbeat: a
  // history row that fails to save is worth nothing next to interrupting
  // somebody mid-conversation, and `keepalive` is what lets the request
  // outlive a tab closed straight after the hangup.
  const flushLeg = (ref: React.RefObject<Leg | null>) => {
    const leg = ref.current;
    if (!leg) return;
    // Cleared first: every path here can run more than once — a re-render, a
    // second notification, an unmount after the state change — and this is
    // what makes all of them harmless.
    ref.current = null;
    fetch("/api/keypad-calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: leg.phone,
        label: leg.label,
        fromDid: did,
        telnyxSessionId: leg.sessionId,
        durationSeconds: leg.seconds,
        addedToCall: leg.addedToCall,
      }),
      keepalive: true,
    }).catch(() => {});
  };

  // Reachable from effects that must not list it as a dependency — the unmount
  // flush below has to run on unmount and nothing else. Same ref pattern as the
  // key handler further down.
  const flushRef = React.useRef(flushLeg);

  // No dependency array on purpose: this refreshes the snapshots on every
  // render, which is what makes the ref hold the last live state of a line
  // rather than whatever it was dialled with.
  React.useEffect(() => {
    flushRef.current = flushLeg;
    if (line.state !== "idle" && firstLeg.current) {
      firstLeg.current.sessionId = line.sessionId;
      firstLeg.current.seconds = line.seconds;
    }
    if (line.second && secondLeg.current) {
      secondLeg.current.sessionId = line.secondSessionId;
      secondLeg.current.seconds = line.second.seconds;
    }
  });

  // A line that has ended. Declared after the effect above so it runs second
  // in the same commit, reading the snapshot that one has just left alone.
  React.useEffect(() => {
    if (!busy) flushRef.current(firstLeg);
  }, [busy]);
  React.useEffect(() => {
    if (!two) flushRef.current(secondLeg);
  }, [two]);

  // Closing the tab or navigating away ends the call — the hook hangs up on
  // unmount — so anything still live is filed on the way out.
  React.useEffect(
    () => () => {
      flushRef.current(secondLeg);
      flushRef.current(firstLeg);
    },
    [],
  );

  const press = React.useCallback(
    (key: string) => {
      if (busy && !adding) {
        // A connected call turns the pad into a tone pad, which is what a
        // phone does and the only way through a switchboard.
        line.sendDigit(key);
        setTones((t) => (t + key).slice(-20));
        return;
      }
      setEntry((v) => withCountryCode((v + key).slice(0, 20)));
    },
    [busy, adding, line, setEntry],
  );

  // Plain functions, not useCallbacks: the React Compiler memoizes them, and
  // wrapping them by hand made the compiler bail on the whole component.
  const call = () => {
    if (!canDial || !target || !did) return;
    setTones("");
    // The hook's timer keeps its last value once a call ends, so a no-answer
    // straight after a two-minute call would otherwise be filed as two
    // minutes. `reset` is what the dialler calls between leads, for this.
    line.reset();
    firstLeg.current = {
      phone: target,
      // The label rides along to the history for the same reason the second
      // leg's does: "pxn junk removal" says what was rung, eleven digits do
      // not. Only when the pad still holds the number that carried it.
      label: chosen?.label ?? null,
      addedToCall: false,
      sessionId: null,
      seconds: 0,
    };
    line.dial(target, did);
  };

  // Taken out of the book: it goes into the pad rather than ringing, which is
  // the opposite of the mid-call list. There, a hand-labelled line is picked
  // with a prospect waiting; here it may be a bare number off an account list,
  // and seeing it in the display before pressing Call is the point of choosing
  // one in advance.
  const pickFromBook = (l: KeypadLine) => {
    setTyped(l.phoneNumber);
    setPicked(l);
    setBookOpen(false);
  };

  const startAdding = () => {
    setAdding(true);
    setSecondTyped("");
    setTones("");
  };

  const cancelAdding = () => {
    setAdding(false);
    setSecondTyped("");
  };

  const callSecond = () => {
    if (!canAdd || !target || !did) return;
    setAdding(false);
    setSecondName(secondTyped);
    secondLeg.current = {
      phone: target,
      label: null,
      addedToCall: true,
      sessionId: null,
      seconds: 0,
    };
    line.addCall(target, did);
  };

  // One tap on a line that has a name. The number is on the account and was
  // labelled by hand, so there is nothing to check about it that the label
  // does not already say — the pad below stays for everything else.
  const callLine = (saved: SavedLine) => {
    const to = e164(saved.phoneNumber);
    if (!to || !did || line.state !== "active" || two) return;
    setAdding(false);
    setSecondName(saved.label);
    secondLeg.current = {
      phone: to,
      // The label is the whole point of these: "pxn junk removal" says what
      // was rung in a way eleven digits in a history never will.
      label: saved.label,
      addedToCall: true,
      sessionId: null,
      seconds: 0,
    };
    line.addCall(to, did);
  };

  // The physical keyboard, because this screen exists to be used quickly and
  // typing a number beats twelve clicks. Guarded on the focused element the
  // way the dialler's `o` hotkey is, so a future input on this page does not
  // start swallowing digits.
  //
  // Held in a ref for the reason `useTouchDrag` does it: everything this
  // touches changes on every keystroke, so a handler in the dependency array
  // would tear the listener down and rebuild it between one digit and the
  // next. The ref is reassigned each render, so it always sees fresh state.
  const onKeyRef = React.useRef<(e: KeyboardEvent) => void>(() => {});
  const handleKey = (e: KeyboardEvent) => {
    if (inTextField()) return;
    const typing = adding || !busy;
    if (/^[0-9*#]$/.test(e.key)) {
      press(e.key);
    } else if (e.key === "+" && typing) {
      setEntry((v) => (v + "+").slice(0, 20));
    } else if (e.key === "Backspace" && typing) {
      e.preventDefault();
      setEntry((v) => v.slice(0, -1));
    } else if (e.key === "Enter") {
      if (adding) callSecond();
      else call();
    } else if (e.key === "o" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // The same key the dialler uses, so it means one thing across the app.
      // Safe beside the pad: "o" is not a digit, and `inTextField` above has
      // already let anything typed into a field through.
      if (script.length > 0) setScriptOpen((v) => !v);
    } else if (e.key === "Escape") {
      // Out of the second number first: escaping straight to a hangup while
      // someone is halfway through typing one would end the call they were
      // adding to.
      if (adding) cancelAdding();
      else if (busy) line.hangup();
    }
  };

  // Ctrl/Cmd-V, which needs a handler of its own because the number on this
  // screen is text on a card and not an input: there is nothing for the
  // browser to paste into. Held in a ref for the same reason the key handler
  // is.
  //
  // Ignored while the pad is sending tones, like `+` and backspace are — a
  // paste in the middle of a call is not fifteen DTMF digits down the line.
  const onPasteRef = React.useRef<(e: ClipboardEvent) => void>(() => {});
  const handlePaste = (e: ClipboardEvent) => {
    if (inTextField() || !(adding || !busy)) return;
    const pasted = pastedNumber(e.clipboardData?.getData("text") ?? "");
    if (!pasted) return;
    e.preventDefault();
    setEntry((v) =>
      // A number carrying its own country code is a whole number, so it
      // replaces whatever was there rather than landing on the end of it —
      // pasting +1 907… onto a typed "+1" should not dial +1 1 907…. Bare
      // digits do append, since those are the national half of a number whose
      // country code may well have just been typed.
      withCountryCode(
        (pasted.startsWith("+") || !v ? pasted : v + pasted).slice(0, 20),
      ),
    );
  };

  // No dependency array: this runs after every render, which is the point —
  // the refs always hold handlers that can see the current state. Writing them
  // during render instead is what `react-hooks/refs` forbids.
  React.useEffect(() => {
    onKeyRef.current = handleKey;
    onPasteRef.current = handlePaste;
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    const onPaste = (e: ClipboardEvent) => onPasteRef.current(e);
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const elapsed = mmss(line.seconds);
  // Anything wrong with the number being typed, in the order it gets fixed.
  // Split on the country code, because a number is typed a digit at a time:
  // half of a US number is not a missing country code, and telling someone to
  // add the +1 already on screen reads as a bug.
  const numberProblem = !entry
    ? null
    : !target
      ? entry.startsWith("+")
        ? "Not a complete number yet."
        : "Start with the country code, like +65 or +1."
      : !DIALLABLE.has(kind)
        ? `${COUNTRY[kind] ?? "That country"} is not switched on for outbound.`
        : null;

  // What to say under the number. One line, and never more than one problem at
  // a time: the first thing in the way is the thing to fix.
  const hint = !did
    ? "No caller ID assigned to you yet — an admin sets one on Team."
    : line.problem
      ? line.problem
      : line.mergeProblem
        ? line.mergeProblem
        : adding
          ? (numberProblem ??
            (entry
              ? `${COUNTRY[kind]} · adding to this call`
              : "Type the number to add."))
          : two
            ? line.merged
              ? "Both calls can hear each other."
              : line.merging
                ? "Joining them the moment the second call answers…"
                : "Merge to let them hear each other."
            : busy
              ? tones
                ? `Tones sent: ${tones}`
                : `Calling from ${did}`
              : (numberProblem ??
                (chosen?.label
                  ? // A line taken out of the book by name. Its name is worth
                    // more here than its country, which is the one thing about
                    // it nobody was choosing on.
                    `${chosen.label} · calling from ${did}`
                  : entry
                    ? `${COUNTRY[kind]} · calling from ${did}`
                    : `Calling from ${did}`));

  return (
    <div
      className={cn(
        "mx-auto w-full",
        objections.length > 0
          ? "max-w-[340px] xl:grid xl:max-w-4xl xl:grid-cols-[minmax(0,24rem)_minmax(0,340px)] xl:justify-center xl:gap-6"
          : "max-w-[340px]",
      )}
    >
      {objections.length > 0 && (
        <aside className="hidden xl:block">
          {sheets.length > 1 && (
            // Only where there is a choice. A caller assigned a market works
            // that market all day and has nothing to pick between; the picker
            // exists for the account that deliberately has no market so it can
            // work all of them.
            <div className="mb-2 flex rounded-lg border bg-card p-1">
              {sheets.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setMarket(s.key)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    s.key === sheet?.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <ObjectionPanel
            sections={objections}
            highlight={hints.hint?.category ?? null}
            exact={hints.hint?.title ?? null}
            heard={hints.hint?.heard ?? null}
          />
        </aside>
      )}

      <div className="min-w-0">
      {line.incoming && (
        <IncomingCall
          key={line.incoming.from}
          incoming={line.incoming}
          busy={line.state !== "idle"}
        />
      )}
      <div className="rounded-[14px] border bg-card p-5 shadow-[0_1px_3px_rgba(41,47,76,0.05)]">
        <div className="min-h-[64px]">
          {two ? (
            <LinePair
              line={line}
              firstLabel={typed || "First call"}
              secondLabel={secondName || "Second call"}
            />
          ) : (
            <>
              {/* The call being added to. Without it the screen is an idle
                  keypad with a Cancel button, and the one thing a person needs
                  to know here is that they are still connected to someone. */}
              {adding && (
                <LineRow label={typed || "First call"} status={elapsed} live />
              )}
              {/* A real input whenever the number can be edited.
                  It was a div, on the reasoning that this is a phone rather
                  than a form — and that cost every affordance a person expects
                  of a number they can change: no caret, so no way to click
                  into the middle or the start of it; Ctrl-A selected the whole
                  page; and nothing on screen said it could be typed into at
                  all.
                  Read-only during a call rather than swapped out, so the
                  number stays put while the pad is sending tones: a connected
                  call turns the keys into DTMF, and editing then would be the
                  wrong behaviour for a phone. */}
              <input
                ref={entryRef}
                value={entry}
                readOnly={!editable}
                inputMode="tel"
                autoComplete="off"
                spellCheck={false}
                aria-label="Number to dial"
                placeholder="+"
                onChange={(e) =>
                  editable &&
                  setEntry(
                    withCountryCode(
                      e.target.value.replace(/[^\d+]/g, "").slice(0, 20),
                    ),
                  )
                }
                onPaste={(e) => {
                  if (!editable) return;
                  const pasted = pastedNumber(e.clipboardData.getData("text"));
                  if (!pasted) return;
                  e.preventDefault();
                  setEntry((v) =>
                    withCountryCode(
                      (pasted.startsWith("+") || !v ? pasted : v + pasted).slice(0, 20),
                    ),
                  );
                }}
                className={cn(
                  "w-full truncate rounded-md bg-transparent text-center font-semibold tabular-nums tracking-tight outline-none",
                  "placeholder:text-muted-foreground/40",
                  adding ? "mt-2 text-[24px]" : "text-[30px]",
                  editable
                    ? "cursor-text focus:bg-muted/40"
                    : "cursor-default select-none",
                )}
              />
            </>
          )}
          <p className="mt-1 min-h-[16px] text-center text-[12px] text-muted-foreground">
            {hint}
          </p>
        </div>

        {/* The lines somebody would actually add: the demo number, a client's
            line. Above the pad because picking one by name is the common case
            and typing eleven digits is the fallback, and they ring on the tap
            — a labelled number needs no checking over. */}
        {adding && lines.length > 0 && (
          <div className="mt-3">
            <SavedLineList lines={lines} onPick={callLine} />
          </div>
        )}

        {/* The book, for a first call. In the same place as the list above so
            that "the numbers I can pick" is one region of this screen rather
            than two, and behind a toggle because the pad is what the screen is
            for — a list that pushed it down the page every time would be the
            wrong way round. Absent entirely for a caller with one market and
            one number, who has nothing to choose. */}
        {!busy && !adding && book.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setBookOpen((o) => !o)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              <BookUser className="size-3.5" />
              {bookOpen ? "Hide numbers" : "Pick a number"}
            </button>
            {bookOpen && <NumberBook lines={book} onPick={pickFromBook} />}
          </div>
        )}

        {liveHints && objections.length > 0 && (
          // Shown whenever the feature is on, not only mid-call. It used to
          // appear only once a call was up, so an idle screen showed the panel
          // and no button and read as the button being missing.
            <div className="mb-3">
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={hints.ask}
              disabled={!hints.available || hints.asking}
            >
              <Ear data-icon="inline-start" />
              {hints.asking
                ? "Checking…"
                : hints.available
                  ? "What did they just say?"
                  : "What did they just say? — on a call"}
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
                    {hints.hint?.title ?? hints.hint?.category}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {PHONE_KEYS.map((k) => (
            <button
              key={k.digit}
              type="button"
              onClick={() => press(k.digit)}
              className="flex h-14 flex-col items-center justify-center rounded-xl border bg-background transition-colors hover:bg-muted active:bg-muted"
            >
              <span className="text-[20px] font-semibold leading-none">
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

        {adding ? (
          // Entering the second number. The same three controls as a first
          // call, because it is a first call as far as the pad is concerned.
          <>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                className="h-12 w-12 p-0 text-[17px] font-semibold"
                aria-label="Plus"
                onClick={() => setSecondTyped((v) => (v + "+").slice(0, 20))}
              >
                +
              </Button>
              <Button className="h-12 flex-1" disabled={!canAdd} onClick={callSecond}>
                <PhoneCall data-icon="inline-start" />
                Call
              </Button>
              <Button
                variant="outline"
                className="h-12 w-12 p-0"
                aria-label="Backspace"
                disabled={!secondTyped}
                onClick={() => setSecondTyped((v) => v.slice(0, -1))}
              >
                <Delete className="size-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              className="mt-2 h-10 w-full text-muted-foreground"
              onClick={cancelAdding}
            >
              Cancel
            </Button>
          </>
        ) : two ? (
          <div className="mt-3">
            <MergeControls line={line} />
          </div>
        ) : busy ? (
          <>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                className="h-12 w-12 p-0"
                aria-label={line.muted ? "Unmute" : "Mute"}
                onClick={line.toggleMute}
              >
                {line.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
              <span className="flex h-12 flex-1 items-center justify-center rounded-xl border bg-muted/40 text-sm font-bold">
                {line.state === "active" ? (
                  <span className="tabular-nums">{elapsed}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {line.state === "ringing" ? "Ringing…" : "Connecting…"}
                  </span>
                )}
              </span>
              <Button
                variant="destructive"
                className="h-12 w-12 p-0"
                aria-label="Hang up"
                onClick={line.hangup}
              >
                <PhoneOff className="size-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              className="mt-2 h-11 w-full"
              disabled={line.state !== "active"}
              onClick={startAdding}
            >
              <UserPlus data-icon="inline-start" />
              Add call
            </Button>
          </>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              className="h-12 w-12 p-0 text-[17px] font-semibold"
              aria-label="Plus"
              onClick={() => setTyped((v) => (v + "+").slice(0, 20))}
            >
              +
            </Button>
            <Button
              className="h-12 flex-1"
              disabled={!canDial}
              onClick={call}
            >
              <PhoneCall data-icon="inline-start" />
              Call
            </Button>
            <Button
              variant="outline"
              className="h-12 w-12 p-0"
              aria-label="Backspace"
              disabled={!typed}
              onClick={() => setTyped((v) => v.slice(0, -1))}
            >
              <Delete className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
        Numbers dialled here show in the call history on Stats, and calls are
        recorded as {callerName}. There is no lead and no outcome, so nothing
        from this screen reaches the figures or the pipeline.
        {two && " A merged call is joined inside this tab — closing it ends both."}
      </p>

      <audio id={REMOTE_AUDIO_ID} autoPlay />
      <audio id={SECOND_AUDIO_ID} autoPlay />
      <ScriptDrawer
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        sections={script}
      />
      </div>
    </div>
  );
}
