"use client";

import * as React from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The two posts a caller owes Slack, as prompts in the app.
 *
 * The SOP says to post them; nothing until now said so at the moment they are
 * due, and a procedure people only meet on their first day is one they stop
 * doing in a fortnight. These are the same two templates, filled in from what
 * the CRM already knows, so posting is a copy and a paste rather than a
 * remembered format and a count done on paper.
 *
 * Both live in this one file so the channel names and the shape of each post
 * cannot drift apart from each other, or from `content/sop/procedure-slack-
 * reporting.md`. If a template changes, it changes in those two places and
 * nowhere else.
 */

export const DAILY_CHANNEL = "#daily-reports";
export const BOOKING_CHANNEL = "#meetings-booked";

/** Copy a block of text, saying so on the button rather than in a toast that
 *  covers the thing just copied. */
function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("h-10", className)}
      onClick={copy}
    >
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** The post itself, shown as it will read in Slack. Seeing the filled-in text
 *  is what makes the copy button trustworthy: a button that copies something
 *  invisible gets pressed once and then retyped by hand. */
function Template({ text }: { text: string }) {
  return (
    <pre className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-background/70 px-3 py-2.5 text-[13px] leading-relaxed">
      {text}
    </pre>
  );
}

export function dailyReportText(
  name: string,
  date: string,
  calls: number,
  pickups: number,
  demos: number,
) {
  return [
    `${name} - ${date}`,
    `Calls made: ${calls}`,
    `Pickups: ${pickups}`,
    `Meetings booked: ${demos}`,
  ].join("\n");
}

/**
 * End of session: today's three numbers, ready to post.
 *
 * Rendered on the call lists screen, which is where a caller starts and
 * finishes, rather than on the dialler where they are mid-queue and not
 * thinking about the day as a whole.
 *
 * The numbers are this person's own calls today, counted the same way the
 * Scoreboard counts them, so the report and the board can never disagree.
 */
export function DailyReportCard({
  name,
  date,
  calls,
  pickups,
  demos,
  zoneName,
}: {
  name: string;
  date: string;
  calls: number;
  pickups: number;
  demos: number;
  /** Which clock "today" was judged in, named out loud: a caller overseas can
   *  otherwise be looking at a day that is not the one they just worked. */
  zoneName: string;
}) {
  const text = dailyReportText(name, date, calls, pickups, demos);

  return (
    <div className="mb-5 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
          Post to {DAILY_CHANNEL}
        </p>
        <p className="text-[12px] text-muted-foreground">
          at the end of your session, today
        </p>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-3">
        {[
          { label: "Calls", value: calls },
          { label: "Pickups", value: pickups },
          { label: "Meetings", value: demos },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {s.value.toLocaleString()}
            </p>
            <p className="text-[13px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <Template text={text} />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <CopyButton text={text} label="Copy the post" />
        <p className="text-[12px] text-muted-foreground">
          Your calls today, {zoneName} time. Only what you logged counts.
        </p>
      </div>
    </div>
  );
}

export function bookingPostText(name: string, lead: string) {
  return [
    `${name} booked a meeting!`,
    `Lead: ${lead}`,
    `Date/time of meeting: `,
    `Trial offered: `,
  ].join("\n");
}

/**
 * Straight after a demo is logged: post it while it is still news.
 *
 * Deliberately not a toast. A toast is gone in five seconds and the caller is
 * on Cal.com finishing the booking, so the reminder has to still be there when
 * they come back. It survives moving on to the next number and goes only when
 * dismissed, which is the caller saying they have posted it.
 *
 * The time and the trial answer are left blank on purpose. The slot lives on
 * Cal.com and does not reach the CRM for a few minutes, so filling it in from
 * here would mean either a wrong time or a wait; both are worse than two words
 * typed into Slack.
 */
export function BookingPostCard({
  name,
  lead,
  onDismiss,
}: {
  name: string;
  lead: string;
  onDismiss: () => void;
}) {
  const text = bookingPostText(name, lead);

  return (
    <div className="mb-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-primary">
            Post to {BOOKING_CHANNEL}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Now, not at the end of the day.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Posted, hide this"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" strokeWidth={2.2} />
        </button>
      </div>

      <Template text={text} />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <CopyButton text={text} label="Copy the post" />
        <Button type="button" variant="ghost" className="h-10" onClick={onDismiss}>
          Posted it
        </Button>
      </div>
    </div>
  );
}
