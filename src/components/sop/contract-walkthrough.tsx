"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  FileSignature,
  MessageSquare,
  MousePointer2,
  Pause,
  Phone,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PACKAGES, money } from "@/lib/packages";
import { cn } from "@/lib/utils";

/**
 * A self-playing picture of sending the agreement, drawn from the Meetings
 * row's own buttons.
 *
 * It exists because the closing SOP used to say "send it" and stop. The steps
 * are a button on a row, a form, a second button, a box with its own link
 * buttons and a last-look dialog, which is easier to watch once than to read.
 *
 * **It is a copy of the screen, not the screen.** The class strings on the
 * buttons are the ones in `meetings-list.tsx` and `prepare-contracts.tsx`, so
 * it looks like the real thing, but nothing here can send, draft or call
 * anything: the stage is `inert`, and the only thing that moves is this
 * component's own state. **If those buttons are renamed or moved, change the
 * steps here too**, or the SOP teaches a screen that no longer exists.
 *
 * - Plays on a loop, with pause, back and next, and a dot per step. Starts
 *   paused for somebody who asked their device for reduced motion.
 * - The words under the picture are the point; the picture is there so the
 *   words can be matched to what is on the screen. The numbered steps in the
 *   document carry the same information for anybody who cannot see it.
 * - Colours come through the theme tokens, so it follows dark mode.
 */

const STEPS = [
  {
    title: "Find their row on Meetings and press Prepare contracts",
    note: "Meetings is in the sidebar. Every booked demo is a row. If the row already shows green agreement chips, the contracts are drafted and you can skip to step 4.",
    ms: 3800,
  },
  {
    title: "Check the business name, then press Draft",
    note: "The name is copied from a directory, so it is often a trading name. Type the name they sign under, such as adding LLC. Pick the package the calculator marked cheapest. Nothing is sent to them yet.",
    ms: 6200,
  },
  {
    title: "The green chips mean the agreements are ready",
    note: "Each chip says not sent. The prospect has seen nothing, and nothing emails itself. You decide when it goes.",
    ms: 4200,
  },
  {
    title: "Press Text them",
    note: "A box opens under the row with a message already written. It sends from your own calling number.",
    ms: 3800,
  },
  {
    title: "Press Add paid agreement link",
    note: "The link is dropped into the message for you. Nothing to copy or paste. Use Add trial agreement link instead if they hesitated and you offered the trial.",
    ms: 4200,
  },
  {
    title: "Press Send text, read it, then press Send",
    note: "A last look shows who it goes to and exactly what it says. Go back is selected first, so a stray Enter cannot send it. A text cannot be unsent.",
    ms: 5200,
  },
  {
    title: "The chip now says sent",
    note: "Ask them to open it now, while you are still on the call. That is the whole send.",
    ms: 4200,
  },
] as const;

const PREFILLED_NAME = "AK Auto Care";
const FIXED_NAME = "AK Auto Care LLC";
const LINK = "https://sign.cyllabs.com/s/Xk3pQ9";
const GREETING =
  "Hey Mike, it's Mark sending over the docs right now, let me know if you have any questions.";

/** The button the picture wants pressed, drawn with a ring and a pointer so
 *  the eye goes there. Nothing about it is clickable. */
function Tap({
  on,
  children,
  className,
}: {
  on: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <span
        className={cn(
          "inline-flex rounded-md transition-shadow duration-300",
          on && "ring-2 ring-primary ring-offset-2 ring-offset-card",
        )}
      >
        {children}
      </span>
      {on && (
        <MousePointer2
          aria-hidden
          className="absolute -bottom-3 -right-2 z-10 size-5 animate-bounce fill-foreground text-background drop-shadow"
        />
      )}
    </span>
  );
}

const rowButton =
  "inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-[13px] font-semibold";

function Chip({ sent }: { sent: boolean }) {
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-md border border-success/40 bg-success/5 animate-in fade-in zoom-in-95 duration-300">
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold">
        <FileSignature className="size-3.5" />
        Paid agreement
        <span
          className={cn(
            "ml-0.5 rounded-[3px] px-1 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
            sent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {sent ? "sent" : "not sent"}
        </span>
      </span>
      <span className="inline-flex items-center border-l border-success/40 px-1.5">
        <ChevronDown className="size-3.5" strokeWidth={2.4} />
      </span>
    </span>
  );
}

export function ContractWalkthrough() {
  const [step, setStep] = React.useState(0);
  // Paused until the effect below has asked the device about motion, so a
  // reduced-motion reader never sees it start.
  const [playing, setPlaying] = React.useState(false);
  const [typed, setTyped] = React.useState(PREFILLED_NAME);

  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlaying(!reduce);
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(
      () => setStep((s) => (s + 1) % STEPS.length),
      STEPS[step].ms,
    );
    return () => window.clearTimeout(t);
  }, [playing, step]);

  // Step 2 types the missing "LLC" in, which is the one thing worth seeing
  // somebody do on that form.
  React.useEffect(() => {
    if (step !== 1) {
      setTyped(PREFILLED_NAME);
      return;
    }
    let n = PREFILLED_NAME.length;
    let timer: number;
    const begin = window.setTimeout(() => {
      timer = window.setInterval(() => {
        n += 1;
        setTyped(FIXED_NAME.slice(0, n));
        if (n >= FIXED_NAME.length) window.clearInterval(timer);
      }, 140);
    }, 1200);
    return () => {
      window.clearTimeout(begin);
      window.clearInterval(timer);
    };
  }, [step]);

  const go = (to: number) => setStep((to + STEPS.length) % STEPS.length);
  const pkg = PACKAGES[0];
  const drafted = step >= 2;
  const composing = step >= 3 && step <= 4;
  const confirming = step === 5;
  const body = step >= 4 ? `${GREETING}\n${LINK}` : GREETING;

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        Watch it: sending the agreement
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        This is a picture of the real screen. Nothing here sends anything. Pause
        it or step through it with the buttons underneath.
      </p>

      {/* The stage. Inert and hidden from a screen reader: it is decoration for
          the caption, which is what carries the meaning. */}
      <div
        aria-hidden
        inert
        className="mt-3 min-h-[430px] overflow-hidden rounded-lg border bg-background p-3 sm:p-4"
      >
        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-[14px] font-bold">Mike Reyes, AK Auto Care</p>
            <p className="text-[12px] text-muted-foreground">Demo today, 2:00 PM</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={rowButton}>
              <Phone className="size-3.5" />
              Call them
            </span>
            <Tap on={step === 3}>
              <span className={cn(rowButton, composing && "bg-muted")}>
                <MessageSquare className="size-3.5" />
                Text them
              </span>
            </Tap>
            {drafted ? (
              <Chip sent={step === 6} />
            ) : (
              <Tap on={step === 0}>
                <span className={rowButton}>
                  <FileSignature className="size-3.5" />
                  Prepare contracts
                </span>
              </Tap>
            )}
            <span className={rowButton}>
              More
              <ChevronDown className="size-3.5" />
            </span>
          </div>

          {/* Step 2: the form, small. The real one is a dialog with more
              fields; these are the ones somebody has to look at. */}
          {step === 1 && (
            <div className="mt-4 rounded-lg border bg-card p-3 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-[14px] font-semibold">Prepare contracts</p>
              <p className="text-[12px] text-muted-foreground">
                Both agreements, filled in and waiting. Nothing is emailed to
                anyone.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Business name</Label>
                  <Input readOnly tabIndex={-1} value={typed} />
                  <p className="text-[12px] text-muted-foreground">
                    Check it is what they sign under.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Package</Label>
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={`${pkg.name}, $${money(pkg.monthlyCents)} / month`}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    The one the calculator marked cheapest.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" tabIndex={-1}>
                  Cancel
                </Button>
                <Tap on={typed === FIXED_NAME}>
                  <Button size="sm" tabIndex={-1}>
                    Draft both
                  </Button>
                </Tap>
              </div>
            </div>
          )}

          {/* Steps 4 to 6: the box that opens under the row. */}
          {composing && (
            <div className="mt-4 rounded-lg border bg-muted/40 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-[13px] font-bold">Text Mike</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                From your number to Mike&rsquo;s. It goes out exactly as written,
                with nothing added.
              </p>
              <Textarea
                readOnly
                tabIndex={-1}
                value={body}
                className="mt-2 min-h-[88px] bg-background"
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Tap on={step === 4}>
                  <span className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[12px] font-semibold">
                    <FileSignature className="size-3" />
                    Add paid agreement link
                  </span>
                </Tap>
                <span className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[12px] font-semibold">
                  Add form link
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Tap on={false}>
                  <Button size="sm" tabIndex={-1}>
                    Send text
                  </Button>
                </Tap>
                <Button size="sm" variant="outline" tabIndex={-1}>
                  Cancel
                </Button>
              </div>

            </div>
          )}

          {confirming && (
                <div className="mt-4 rounded-lg border bg-card p-3 shadow-lg animate-in fade-in zoom-in-95 duration-300">
                  <p className="text-[14px] font-semibold">Send this text?</p>
                  <p className="text-[12px] text-muted-foreground">
                    It reaches their phone the moment you press Send. A text
                    can&rsquo;t be unsent.
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 text-[12px]">
                    {body}
                  </p>
                  <p className="mt-2 rounded-md bg-primary/10 px-2 py-1 text-[12px] font-semibold text-primary">
                    This message contains a link.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" size="sm" tabIndex={-1} className="ring-2 ring-ring/50">
                      Go back
                    </Button>
                    <Tap on className="animate-in fade-in delay-[1800ms] duration-300 fill-mode-both">
                      <Button size="sm" tabIndex={-1}>
                        Send
                      </Button>
                    </Tap>
                  </div>
                </div>
              )}

          {step === 6 && (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-[13px] font-semibold animate-in fade-in duration-300">
              <Check className="size-3.5" strokeWidth={2.6} />
              Text sent to Mike
            </p>
          )}
        </div>
      </div>

      <div className="mt-3" role="status" aria-live="polite">
        <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-primary">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="mt-0.5 text-[15px] font-bold leading-snug">{STEPS[step].title}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          {STEPS[step].note}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(step - 1)}
          aria-label="Previous step"
        >
          <SkipBack className="size-3.5" />
          Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(step + 1)}
          aria-label="Next step"
        >
          Next
          <SkipForward className="size-3.5" />
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === step}
              onClick={() => setStep(i)}
              className={cn(
                "size-2.5 rounded-full transition-colors",
                i === step ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
