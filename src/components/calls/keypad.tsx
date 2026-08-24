"use client";

import * as React from "react";
import { Delete, Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyPhone, e164 } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useTelnyxCall } from "./use-telnyx-call";

const REMOTE_AUDIO_ID = "keypad-remote-audio";

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
}: {
  /** The caller ID this person rings from, or null if they have none yet. */
  did: string | null;
  callerName: string;
}) {
  const [typed, setTyped] = React.useState("");
  // Tones pressed during a call, kept apart from the number so pressing 2 to
  // reach a department does not rewrite what you dialled.
  const [tones, setTones] = React.useState("");

  const line = useTelnyxCall(REMOTE_AUDIO_ID, Boolean(did));
  const busy = line.state !== "idle";

  const kind = typed ? classifyPhone(typed) : "missing";
  const target = e164(typed);
  const ready = Boolean(did) && line.ready && !busy;
  const canDial = ready && Boolean(target) && DIALLABLE.has(kind);

  const press = React.useCallback(
    (key: string) => {
      if (busy) {
        // A connected call turns the pad into a tone pad, which is what a
        // phone does and the only way through a switchboard.
        line.sendDigit(key);
        setTones((t) => (t + key).slice(-20));
        return;
      }
      setTyped((v) => (v + key).slice(0, 20));
    },
    [busy, line],
  );

  // Plain function, not a useCallback: the React Compiler memoizes it, and
  // wrapping it by hand made the compiler bail on the whole component.
  const call = () => {
    if (!canDial || !target || !did) return;
    setTones("");
    line.dial(target, did);
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
    const el = document.activeElement;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable) {
      return;
    }
    if (/^[0-9*#]$/.test(e.key)) {
      press(e.key);
    } else if (e.key === "+" && !busy) {
      setTyped((v) => (v + "+").slice(0, 20));
    } else if (e.key === "Backspace" && !busy) {
      e.preventDefault();
      setTyped((v) => v.slice(0, -1));
    } else if (e.key === "Enter") {
      call();
    } else if (e.key === "Escape" && busy) {
      line.hangup();
    }
  };

  // No dependency array: this runs after every render, which is the point —
  // the ref always holds a handler that can see the current state. Writing it
  // during render instead is what `react-hooks/refs` forbids.
  React.useEffect(() => {
    onKeyRef.current = handleKey;
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mmss = `${Math.floor(line.seconds / 60)}:${String(line.seconds % 60).padStart(2, "0")}`;

  // What to say under the number. One line, and never more than one problem at
  // a time: the first thing in the way is the thing to fix.
  const hint = !did
    ? "No caller ID assigned to you yet — an admin sets one on Team."
    : line.problem
      ? line.problem
      : busy
        ? tones
          ? `Tones sent: ${tones}`
          : `Calling from ${did}`
        : !typed
          ? `Calling from ${did}`
          : !target
            ? // Split, because a number is typed a digit at a time: half of a
              // US number is not a missing country code, and telling someone
              // to add the +1 already on screen reads as a bug.
              typed.startsWith("+")
              ? "Not a complete number yet."
              : "Start with the country code, like +65 or +1."
            : DIALLABLE.has(kind)
              ? `${COUNTRY[kind]} · calling from ${did}`
              : `${COUNTRY[kind] ?? "That country"} is not switched on for outbound.`;

  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div className="rounded-[14px] border bg-card p-5 shadow-[0_1px_3px_rgba(41,47,76,0.05)]">
        <div className="min-h-[64px] text-center">
          <div
            className={cn(
              "truncate text-[30px] font-semibold tabular-nums tracking-tight",
              !typed && "text-muted-foreground/40",
            )}
          >
            {typed || "+"}
          </div>
          <p className="mt-1 min-h-[16px] text-[12px] text-muted-foreground">
            {hint}
          </p>
        </div>

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

        {busy ? (
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
                <span className="tabular-nums">{mmss}</span>
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
      </p>

      <audio id={REMOTE_AUDIO_ID} autoPlay />
    </div>
  );
}
