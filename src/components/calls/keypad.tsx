"use client";

import * as React from "react";
import { Delete, Mic, MicOff, PhoneCall, PhoneOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyPhone, e164 } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  LinePair,
  LineRow,
  MergeControls,
  SavedLineList,
  mmss,
  type SavedLine,
} from "./second-line";
import { useTelnyxCall } from "./use-telnyx-call";

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

/** The letters a phone has always had under its digits. Nothing reads them —
 *  they are what makes a keypad recognisable as one at a glance. */
const KEYS: { digit: string; letters?: string }[] = [
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
 * A phone, with no lead behind it.
 *
 * Every other way to place a call in here starts from a `call_lead`, which is
 * right for the work and wrong for testing: checking that the line comes up,
 * that the caller ID is what you bought, or that a number answers meant
 * importing a CSV of invented businesses first, and those leads then sat in
 * the pipeline and the stats being counted as work.
 *
 * So nothing here is written down. No `call` row, which means no outcome, no
 * lead state, and nothing reaching Stats, the board or the Scoreboard. The
 * recording still happens — that is set on the outbound voice profile and
 * there is no per-call switch — so a test call is recorded like any other, and
 * the screen says so rather than letting someone assume otherwise.
 */
export function Keypad({
  did,
  callerName,
  lines,
}: {
  /** The caller ID this person rings from, or null if they have none yet. */
  did: string | null;
  callerName: string;
  /** Labelled numbers on the account that belong to nobody: demo lines and
   *  client lines, offered by name when adding somebody to a call. */
  lines: SavedLine[];
}) {
  const [typed, setTyped] = React.useState("");
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
  const busy = line.state !== "idle";
  const two = line.second !== null;

  // One entry field, two possible numbers behind it. Everything that judges a
  // number — the country, whether it is complete, whether outbound is switched
  // on for it — then reads the same way for the first call and the second.
  const entry = adding ? secondTyped : typed;
  const setEntry = adding ? setSecondTyped : setTyped;
  const kind = entry ? classifyPhone(entry) : "missing";
  const target = e164(entry);
  const diallable = Boolean(target) && DIALLABLE.has(kind);
  const canDial = Boolean(did) && line.ready && !busy && diallable;
  const canAdd = adding && line.state === "active" && !two && diallable;

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
    line.dial(target, did);
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
                (entry ? `${COUNTRY[kind]} · calling from ${did}` : `Calling from ${did}`));

  return (
    <div className="mx-auto w-full max-w-[340px]">
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
              <div
                className={cn(
                  "truncate text-center font-semibold tabular-nums tracking-tight",
                  adding ? "mt-2 text-[24px]" : "text-[30px]",
                  !entry && "text-muted-foreground/40",
                )}
              >
                {entry || "+"}
              </div>
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

        <div className="mt-4 grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
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
        Nothing dialled here is logged: no lead, no outcome, and nothing in
        Stats or the pipeline. Calls are still recorded, as {callerName}.
        {two && " A merged call is joined inside this tab — closing it ends both."}
      </p>

      <audio id={REMOTE_AUDIO_ID} autoPlay />
      <audio id={SECOND_AUDIO_ID} autoPlay />
    </div>
  );
}
