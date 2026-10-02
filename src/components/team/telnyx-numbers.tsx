"use client";

import * as React from "react";
import { PhoneOutgoing } from "lucide-react";
import type { TeamMember } from "@/lib/users";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NumberHealth } from "@/lib/number-health";

/**
 * What numbers the business owns, and who rings from each.
 *
 * Read-only on purpose. Numbers are bought, ported and released in the Telnyx
 * portal; the CRM's job is only to say which person uses which. An earlier
 * version let a number be set per market here as well, which meant the caller
 * ID on a call could come from two places and the screen showed neither.
 *
 * It exists because deleting that left nowhere to see the numbers at all, and
 * "assign one of your numbers" is a hard instruction to follow when the app
 * never says what you have.
 */
/** The colour and the plain words for a number's health. Nothing here says
 *  "reach": a caller or founder reads how many calls out of a hundred got
 *  through, and what to do about it. */
function HealthLine({ h }: { h: NumberHealth }) {
  const since = h.inUseSince
    ? new Date(h.inUseSince).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;
  // What the colour rests on, in words a caller can follow. The strongest sign
  // is calls that end the moment they are placed: an unanswered call normally
  // rings for 20 seconds or more, and one a carrier refuses is gone in a few.
  const quick: string[] = [];
  if (h.fastFail !== null && h.fastFail >= 10) {
    quick.push(
      `${h.fastFail} out of 100 calls were dropped within 8 seconds${h.fastFailBefore !== null ? ` (${h.fastFailBefore} the week before)` : ""}`,
    );
  }
  if (h.refused !== null && h.refused >= 10) {
    quick.push(`${h.refused} out of 100 were refused outright by the carrier or phone`);
  }
  const reachLow = h.reach !== null && h.reach < 70;
  const reachSays =
    h.reach === null
      ? ""
      : reachLow
        ? `Only ${h.reach} out of 100 calls got through${h.reachBefore !== null ? ` (${h.reachBefore} the week before)` : ""}.`
        : h.reachBefore !== null && h.reachBefore - h.reach >= 15
          ? `${h.reach} out of 100 calls got through, down from ${h.reachBefore} the week before.`
          : `${h.reach} out of 100 calls got through this week.`;
  const quickSays = quick.length
    ? `${quick.join(", and ")}. A normal unanswered call rings for 20 seconds or more.`
    : h.fastFail !== null && h.status === "healthy"
      ? h.fastFail === 0
        ? "None dropped in the first 8 seconds."
        : `Only ${h.fastFail} out of 100 dropped in the first 8 seconds.`
      : "";
  const ringsOut =
    quick.length === 0 && reachLow
      ? " They ring out in full, so it may be the lists or the hours rather than the number."
      : "";
  const look = {
    healthy: {
      dot: "bg-success",
      text: "text-success",
      title: "Healthy",
      says: `${reachSays} ${quickSays}`.trim(),
    },
    watch: {
      dot: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      title: "Keep an eye on it",
      says: `${quickSays} ${reachSays}${ringsOut}`.trim(),
    },
    flagged: {
      dot: "bg-destructive",
      text: "text-destructive",
      title: "Probably flagged as spam",
      says: `${quickSays} ${reachSays}`.trim(),
    },
    few: {
      dot: "bg-muted-foreground/40",
      text: "text-muted-foreground",
      title: "Too few calls to tell",
      says:
        h.total > h.calls
          ? `${h.total} calls this week, but only ${h.calls} were logged with an outcome. It takes 100 logged calls to judge.`
          : `${h.calls} call${h.calls === 1 ? "" : "s"} this week. It takes 100 to judge.`,
    },
  }[h.status];
  // Judged from how long its recorded calls last, because too few were logged
  // with an outcome to use the other measure. Said plainly, and always "looks
  // healthy" or "keep an eye on it": it is the weaker signal.
  const L = h.basis === "lengths" ? h.lengths : null;
  if (L) {
    const before =
      L.longPctBefore !== null ? `, ${L.longPctBefore}% the week before` : "";
    look.title = h.status === "healthy" ? "Looks healthy" : "Keep an eye on it";
    look.says =
      h.status === "healthy"
        ? `${L.longPct} out of 100 of its ${L.n} recorded calls ran past 30 seconds${before}. Typical call: ${L.medianSec} seconds.`
        : L.longPctBefore !== null && L.longPct >= 40
          ? `${L.longPct} out of 100 of its ${L.n} recorded calls ran past 30 seconds, down from ${L.longPctBefore} the week before, and ${L.shortPct} ended within 10 seconds.`
          : `Only ${L.longPct} out of 100 of its ${L.n} recorded calls ran past 30 seconds${before}, and ${L.shortPct} ended within 10 seconds. Healthy numbers are usually at 50 or more.`;
    look.says += ` Judged from call length, since only ${h.calls} of its ${h.total} calls were logged with an outcome.`;
  }
  return (
    <p className="basis-full text-[12px] text-muted-foreground">
      <span className={cn("inline-flex items-center gap-1.5 font-bold", look.text)}>
        <span className={cn("size-2 rounded-full", look.dot)} aria-hidden />
        {look.title}
      </span>{" "}
      {look.says} {h.perDay} calls a day{since ? `, in use since ${since}` : ""}.
    </p>
  );
}

const COUNTRY = { SG: "Singapore", US: "US", GB: "UK" } as const;

export function TelnyxNumbers({
  numbers: initial,
  team,
  health,
  className,
}: {
  numbers: {
    phoneNumber: string;
    country: string | null;
    inbound: string | null;
    available: boolean;
    label: string | null;
  }[];
  team: TeamMember[];
  /** How each number is doing, by number. A number nobody has dialled from is
   *  absent, and says nothing. */
  health: Record<string, NumberHealth>;
  className?: string;
}) {
  const router = useRouter();
  const [numbers, setNumbers] = React.useState(initial);
  // Server data wins whenever the page refreshes.
  React.useEffect(() => setNumbers(initial), [initial]);

  // Which number's label is being typed, and what into. One at a time: this is
  // a note on a row, not a form.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const holder = (n: string) => team.find((t) => t.telnyxDid === n) ?? null;

  /**
   * Everyone ringing from this number, not just the first one found.
   *
   * Two people on one number is allowed but nearly always a mistake — both
   * dial out from it and an inbound call can only ring one of them. `find`
   * showed one name and made the other invisible, which is how the founders'
   * account sat on a caller's number unnoticed. Naming both is what makes the
   * state findable at a glance.
   */
  const holders = (n: string) => team.filter((t) => t.telnyxDid === n);

  async function saveLabel(phoneNumber: string, raw: string) {
    const label = raw.trim() === "" ? null : raw.trim();
    setEditing(null);
    const before = numbers.find((n) => n.phoneNumber === phoneNumber)?.label ?? null;
    if (label === before) return;

    setNumbers((p) =>
      p.map((n) => (n.phoneNumber === phoneNumber ? { ...n, label } : n)),
    );
    // Only `label` goes up. Sending `available` alongside it would make
    // renaming a note capable of putting a client's line back in the pool.
    const res = await fetch("/api/call-dids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, label }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      toast.error(data?.error ?? "Could not save the label.");
      setNumbers((p) =>
        p.map((n) =>
          n.phoneNumber === phoneNumber ? { ...n, label: before } : n,
        ),
      );
    }
  }

  async function toggle(phoneNumber: string, available: boolean) {
    setNumbers((p) =>
      p.map((n) => (n.phoneNumber === phoneNumber ? { ...n, available } : n)),
    );
    const res = await fetch("/api/call-dids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, available }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Could not save.");
      setNumbers((p) =>
        p.map((n) =>
          n.phoneNumber === phoneNumber ? { ...n, available: !available } : n,
        ),
      );
      return;
    }
    // The assign dropdowns are rendered from this same list on the server, so
    // the table below has to be told rather than left showing a stale option.
    router.refresh();
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-[-0.01em]">
          <PhoneOutgoing className="size-4 text-muted-foreground" strokeWidth={2.2} />
          Your Telnyx numbers
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Reserve the ones answering for a client and they stop appearing as
          options below. Label one to record what it is for, like a demo line,
          which is separate from whether anyone dials from it. Buy and release
          them in the Telnyx portal. Assigning one here only
          sets what a prospect sees; it changes nothing about the number in
          Telnyx. But a prospect who rings back reaches whatever is already on
          the other end, so avoid the ones answering for a client.
        </p>
      </div>

      {numbers.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">
          No numbers on the account, or Telnyx could not be reached.
        </p>
      ) : (
        <ul className="divide-y">
          {numbers.map((n) => {
            const who = holder(n.phoneNumber);
            return (
              <li
                key={n.phoneNumber}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
              >
                <span className="font-bold tabular-nums">{n.phoneNumber}</span>
                <span className="text-muted-foreground">
                  {COUNTRY[n.country as keyof typeof COUNTRY] ?? n.country ?? "-"}
                </span>
                {n.inbound && (
                  <span
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    title={`Inbound calls to this number go to "${n.inbound}"`}
                  >
                    answers: {n.inbound}
                  </span>
                )}

                {/* Our own note, next to Telnyx's wiring badge because they
                    answer neighbouring questions: that one says what picks up,
                    this one says what the number is for. */}
                {editing === n.phoneNumber ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={60}
                    placeholder="e.g. demo line, Acme"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => saveLabel(n.phoneNumber, draft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveLabel(n.phoneNumber, draft);
                      // Escape has to clear the editor before blur fires, or
                      // the blur handler saves the draft it just abandoned.
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-6 w-44 rounded-md border bg-background px-1.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                  />
                ) : n.label ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(n.label ?? "");
                      setEditing(n.phoneNumber);
                    }}
                    className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/15"
                    title="Rename this label"
                  >
                    {n.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("");
                      setEditing(n.phoneNumber);
                    }}
                    className="text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground"
                  >
                    + Label
                  </button>
                )}
                <span
                  className={cn(
                    "ml-auto",
                    holders(n.phoneNumber).length > 1
                      ? "font-bold text-destructive"
                      : who
                        ? "font-semibold"
                        : "text-muted-foreground",
                  )}
                  title={
                    holders(n.phoneNumber).length > 1
                      ? "Two people ring from this number. Inbound calls to it can only reach one of them."
                      : undefined
                  }
                >
                  {n.available
                    ? holders(n.phoneNumber).length > 0
                      ? holders(n.phoneNumber)
                          .map((t) => t.name)
                          .join(" + ")
                      : "Nobody yet"
                    : "Reserved"}
                </span>
                {/* Never disabled. It used to refuse "Make available" while
                    somebody held the number — `!n.available && !!who` — which
                    put the guard on the wrong side: reserving an assigned
                    number is the questionable act, un-reserving it is purely
                    additive. One mis-click on Reserve therefore locked the
                    undo behind unassigning a caller, a destructive detour to
                    escape a slip. A founder hit exactly that on 2026-09-16.

                    Making it available again changes nothing about who holds
                    it or what Telnyx does; it only lets the number appear as
                    an option again, and `offerFor` already labels a held one
                    "in use by <name>" and asks before handing it out twice. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  title={
                    !n.available && who
                      ? `Still assigned to ${who.name}. Making it available only puts it back in the dropdowns.`
                      : undefined
                  }
                  onClick={() => toggle(n.phoneNumber, !n.available)}
                >
                  {n.available ? "Reserve" : "Make available"}
                </Button>
                {health[n.phoneNumber] && <HealthLine h={health[n.phoneNumber]} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
