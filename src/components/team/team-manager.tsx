"use client";

import { isFloor, ROLE_LABEL, type Role } from "@/lib/roles";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Handshake,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { TeamMember } from "@/lib/users";
import type { PoolList, TeamList } from "@/lib/lead-stock";
import { callerUrgency, whenOut } from "@/lib/lead-words";
import { AssignListMenu } from "@/components/team/assign-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

/** Pinned like every other date in the calling screens: the droplet is UTC
 *  and the team is in Singapore, and an unpinned date is a hydration
 *  mismatch on every row. */
const fmt = (iso: string | null, tz: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        timeZone: tz,
      })
    : null;

/** The join date in full, for the column's tooltip. `fmt` drops the year,
 *  which is fine for "last dialled" and wrong for somebody who started in
 *  March. */
const joined = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  });

/**
 * How long they have been with us, in the largest unit that reads plainly.
 *
 * Words rather than a date, because the question this answers is "is this
 * person new" — a date makes you do the arithmetic, which is the reason the
 * column was asked for at all. The exact day is on the tooltip.
 */
function tenure(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const y = `${years} year${years === 1 ? "" : "s"}`;
  return months > 0 ? `${y} ${months} mo` : y;
}

/**
 * What one person has left across every list they hold.
 *
 * The bars above say how far through each list is, which is not the same
 * question as "how much work has this person got" — and that is the one the
 * warning at the top is answering, so the row it is about had better answer it
 * too. Their own pace, the same divisor `callersRunningOut` uses: 333 leads is
 * three days for the man who starts 121 a day and a fortnight for somebody who
 * starts 25.
 */
function LeadTotal({
  lists,
  perDay,
}: {
  lists: TeamList[];
  perDay: number;
}) {
  const uncalled = lists.reduce((n, l) => n + l.uncalled, 0);
  const left = lists.reduce((n, l) => n + l.leftToCall, 0);
  const daysLeft = perDay > 0 && uncalled > 0 ? uncalled / perDay : null;
  return (
    <p className="border-t pt-1.5 text-[11px] tabular-nums text-muted-foreground">
      {/* Coloured only when the warning above would fire on it — a row where
          every figure shouts says nothing. `callerUrgency` returns nothing at
          all for somebody with no pace to divide by. */}
      <span
        className={cn(
          "font-semibold text-foreground",
          callerUrgency(uncalled, daysLeft),
        )}
      >
        {uncalled === 0
          ? "No new leads left"
          : `${uncalled.toLocaleString("en-US")} never rung in all`}
      </span>
      {uncalled === 0 && left > 0 && ` · ${left} still to ring back`}
      {/* Its own line rather than a wrap: at this column's width "about 20
          days at 4 a day" broke after "a" and left "day" stranded. */}
      {daysLeft !== null ? (
        <span className="block">
          {whenOut(daysLeft)} at {Math.round(perDay)} a day
        </span>
      ) : perDay > 0 ? (
        <span className="block">rings {Math.round(perDay)} new a day</span>
      ) : null}
    </p>
  );
}

const NO_DID = "__market__";

/** Only that person's market. A US number ringing Singapore leads is worse
 *  than sharing a Singapore one, and the API refuses it anyway.
 *
 *  Someone with *no* market is the exception, not a person to refuse — see
 *  `numbersFor`. */
const PREFIX: Record<string, string> = { sg: "+65", us: "+1", gb: "+44" };
const MARKET_LABEL: Record<string, string> = { sg: "Singapore", us: "US", gb: "UK" };

/**
 * One list, so the empty and "show switched off" rows can span all of it.
 * Both said `colSpan={COLUMNS.length}` long after the table grew past nine.
 *
 * **Fifteen columns became nine on 2026-09-22**, after granting texting meant
 * scrolling so far right that the name was off the screen and the heading was
 * off the top — so you could not see who you were granting it to, or which
 * permission the column was. Four things fixed that, and they are all worth
 * keeping:
 *
 * - **Person carries its own detail.** Username, tenure and role were three
 *   columns of one-word answers about somebody whose name was in the column
 *   beside them. They sit under the name now.
 * - **The three permissions are one cell**, each labelled where it is. A
 *   toggle whose meaning lives in a heading twelve columns away is a toggle
 *   you have to scroll to read.
 * - **Calls and Last dialled are one cell**, for the same reason: "250" and
 *   "Sep 21" are one answer about how much work somebody is doing.
 * - **Person is sticky and so is the heading row**, so neither can leave the
 *   screen however far right you scroll.
 */
const COLUMNS = [
  "Person",
  "Market",
  "Call lists",
  "Dials with",
  "Their number",
  "Paid by",
  "Permissions",
  "Calls",
  "",
];

/**
 * One permission, saying its own name.
 *
 * A chip rather than a column, because the three of them used to be three
 * columns of one word each — "Granted", "Off", "Grant" — and which permission
 * you were granting lived in a heading you had to scroll up to read, about a
 * person whose name you had to scroll left to see.
 *
 * The label is always visible and the state is carried by weight and colour,
 * so the whole answer is in the chip: "Texting Granted" reads without moving
 * the page. Pressing it toggles; `always` is the admin case, where there is
 * nothing to toggle because the permission is implied by the role.
 */
function PermissionToggle({
  label,
  on,
  always = false,
  canManage,
  busy,
  onToggle,
}: {
  label: string;
  on: boolean;
  /** True where the role grants it regardless of the stored column. */
  always?: boolean;
  canManage: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const state = always ? "Always" : on ? "Granted" : "Off";

  if (always || !canManage) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
          on || always
            ? "border-primary/30 text-primary"
            : "text-muted-foreground",
        )}
      >
        <span className="font-semibold">{label}</span>
        <span>{state}</span>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      // Pressed state announced, since colour alone is what separates granted
      // from not.
      aria-pressed={on}
      title={`${label}: ${state}. Press to ${on ? "take it away" : "grant it"}.`}
      className={cn(
        "h-6 gap-1 rounded-md border px-2 text-[11px] font-normal",
        on
          ? "border-primary/30 font-semibold text-primary"
          : "text-muted-foreground",
      )}
      disabled={busy}
      onClick={onToggle}
    >
      <span className="font-semibold">{label}</span>
      <span>{busy ? "…" : state}</span>
    </Button>
  );
}

export function TeamManager({
  numbers: accountNumbers,
  team,
  lists,
  pool,
  pace,
  meId,
  canManage,
  tz,
}: {
  numbers: { phoneNumber: string; available: boolean }[];
  team: TeamMember[];
  /** Each person's call lists with how far through them they are, keyed by
   *  user id. Built on the server from `getCallLists` rather than carried on
   *  `TeamMember`, so this screen and the Call lists cards draw one set of
   *  numbers — see `listsByOwner`. */
  lists: Record<number, TeamList[]>;
  /** The lists nobody holds, so somebody running low can be given one here
   *  rather than on Call lists. */
  pool: PoolList[];
  /** Fresh leads each person starts on a day they ring, keyed by user id.
   *  Absent means they have rung nothing new this week, so their row shows a
   *  total and no estimate rather than an estimate off no evidence. */
  pace: Record<number, number>;
  meId: number | null;
  canManage: boolean;
  /** The clock this screen's dates are read in — the reader's reporting zone,
   *  the same one Stats and the Spreadsheet use. Pinned to Singapore until
   *  2026-09-18. */
  tz: string;
}) {
  const router = useRouter();
  const iAmOwner = team.some((t) => t.id === meId && t.isOwner);
  /** Somebody's lists. Missing means none, not a bug: only the people holding
   *  one appear in the map at all. */
  const listsOf = (id: number): TeamList[] => lists[id] ?? [];
  /**
   * Whether the switched-off accounts are showing.
   *
   * They are folded away by default because there are more of them than there
   * are people working — ten against six — and a screen where most rows are
   * former staff is one where the row you came to change is hard to find.
   * Deleting them is not the alternative: their calls, payouts and numbers all
   * hang off those rows, which is why switching off exists at all.
   */
  const [showOff, setShowOff] = React.useState(false);
  const off = team.filter((m) => !m.active).length;
  const shown = showOff ? team : team.filter((m) => m.active);
  const numbers = accountNumbers
    .filter((n) => n.available)
    .map((n) => n.phoneNumber);
  /**
   * The numbers this person may be given, which is their market's.
   *
   * No market means *every* market, so it means every number — the same
   * reading the Keypad's book of numbers uses. It returned nothing at all
   * until 2026-08-28, which left the founders' own account, the one account
   * deliberately tied to no market, with a dropdown holding "Not assigned" and
   * the number it already had. Nothing said why, because from here it looks
   * identical to owning one number.
   */
  const numbersFor = (region: string | null) =>
    region ? numbers.filter((n) => n.startsWith(PREFIX[region] ?? "+")) : numbers;

  /**
   * Who already rings from this number, ignoring the person being edited.
   *
   * The dropdown has always offered numbers somebody else holds — `available`
   * is the reserved flag on the numbers panel, not an assignment — and said
   * nothing about it, so handing one out twice took a single click and left no
   * trace. That is how the founders' account and a caller ended up sharing a
   * number for a fortnight: both dialled out from it, and inbound calls to it
   * rang whichever of the two the database returned first.
   *
   * Same lookup `telnyx-numbers.tsx` uses for its own column, so the panel and
   * the dropdown cannot disagree about whose a number is.
   */
  const holderOf = (phone: string, exceptId: number) =>
    team.find((t) => t.telnyxDid === phone && t.id !== exceptId) ?? null;

  /** Free numbers first. A taken one is still pickable — see the confirm — but
   *  it should never be the first thing under the cursor. */
  const offerFor = (region: string | null, exceptId: number) =>
    [...numbersFor(region)].sort((a, b) => {
      const ta = holderOf(a, exceptId) ? 1 : 0;
      const tb = holderOf(b, exceptId) ? 1 : 0;
      return ta - tb;
    });
  const [adding, setAdding] = React.useState(false);
  /** The caller being replaced by somebody new, if any. */
  const [replacing, setReplacing] = React.useState<TeamMember | null>(null);
  /** The person whose password is being reset, if any. */
  const [resetting, setResetting] = React.useState<TeamMember | null>(null);
  /** The person being renamed. Separate from the reset dialog because the two
   *  are different risks — one is a typo fix, the other locks somebody out. */
  const [renaming, setRenaming] = React.useState<TeamMember | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  async function patch(
    member: TeamMember,
    body: Record<string, unknown>,
    /** What to say when it lands. Defaults to naming the person, which is the
     *  part a founder cannot see once the row is scrolled sideways. */
    saved?: string,
  ) {
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/users/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that.");
        return false;
      }
      // **Say so out loud.** Only failures spoke before, and a save that
      // worked looked identical to one that had hung: the control greys out,
      // `router.refresh()` re-renders a page that takes about two seconds on
      // the droplet, and nothing moves until it lands. A founder granting
      // Brian texting on 2026-09-22 read that as frozen and reported it as a
      // bug — the grant had in fact saved.
      toast.success(saved ?? `Saved for ${member.name}.`);
      // The permission itself always saves; this is Telnyx's own campaign
      // link/unlink not confirming, which used to fail silently — see
      // `linkTextingCampaign` in lib/telnyx.ts.
      if (typeof data.warning === "string") toast.warning(data.warning);
      router.refresh();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Everyone signs in with their own account, and every call they log is
          recorded against them. Switching someone off stops them signing in
          and leaves their calls in the numbers.
        </p>
        {canManage && (
          <Button
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" />
            Add person
          </Button>
        )}
      </div>

      <div className={cn(CARD, "overflow-hidden")}>
        {/* Scrolls in both directions inside the card, which is what lets the
            heading row and the Person column stay put. `overflow-x-auto`
            alone computes overflow-y to auto as well, but with no height to
            scroll against the sticky heading tracked the page instead and
            slid off the top — hence the cap. */}
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                {COLUMNS.map(
                  (h, i) => (
                    <th
                      key={h || "actions"}
                      className={cn(
                        "whitespace-nowrap border-b bg-card px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                        // Sticky needs a solid background of its own: rows
                        // scrolling underneath a transparent heading is the
                        // same fault the incoming-call banner had.
                        "sticky top-0 z-20",
                        // Person stays put horizontally too, so the name is
                        // never off the screen while you work the right-hand
                        // columns. z-30 so the corner cell wins both ways.
                        i === 0 && "left-0 z-30",
                        // By name, not position: an index here drifted onto
                        // "Paid by" as columns were added in front of Calls.
                        h === "Calls" && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Nobody yet.
                  </td>
                </tr>
              ) : (
                shown.map((m) => (
                  <tr
                    key={m.id}
                    className={cn(
                      "border-b last:border-0",
                      // Every cell to the top of the row, not the middle. A
                      // caller holding five lists makes a row four hundred
                      // pixels tall, and centred controls left the market
                      // dropdown floating halfway down beside a name pinned
                      // at the top — so the row stopped reading as one band.
                      "[&>td]:align-top",
                      !m.active && "opacity-55",
                    )}
                  >
                    {/* Everything that identifies somebody, in the one cell
                        that never scrolls away: who they are, what they sign
                        in as, how long they have been here, and whether they
                        are switched off. `bg-card` is not decoration — a
                        sticky cell without it has the row showing through it.
                        `opacity-55` on a switched-off row applies to the whole
                        <tr>, so this stays consistent with it. */}
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b bg-card px-4 py-2.5 align-top font-semibold">
                      <span className="flex items-center gap-1.5">
                        {m.role === "admin" ? (
                          <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {m.name}
                        {m.id === meId && (
                          <span className="text-[11px] font-medium text-muted-foreground">
                            (you)
                          </span>
                        )}
                        {m.isOwner && (
                          <Badge variant="outline" className="shrink-0">
                            Founder
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <span>{m.username}</span>
                        <span aria-hidden>·</span>
                        {/* Counted from now, so it can cross a day boundary
                            between the server render and the hydration — the
                            same note the relative times elsewhere carry. */}
                        <span
                          suppressHydrationWarning
                          title={`Joined ${joined(m.createdAt, tz)}`}
                        >
                          {tenure(m.createdAt)}
                        </span>
                        {/* Only when it is not the ordinary case. An "Admin"
                            or "Switched off" tag says something; a "Caller"
                            tag on thirteen of fifteen rows is noise, and the
                            icon beside the name already carries it. */}
                        {(!m.active || m.role !== "caller") && (
                          <>
                            <span aria-hidden>·</span>
                            <Badge
                              variant={m.active ? "secondary" : "outline"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {!m.active ? "Switched off" : ROLE_LABEL[m.role]}
                            </Badge>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.callRegion ?? "all"}
                          disabled={busyId === m.id}
                          onValueChange={(v) =>
                            patch(m, { callRegion: v === "all" ? null : v })
                          }
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sg">Singapore</SelectItem>
                            <SelectItem value="us">US</SelectItem>
                            <SelectItem value="gb">UK</SelectItem>
                            {/* Not a market — it is "show me everything",
                                which is what an admin reviewing both wants. */}
                            <SelectItem value="all">Every region</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.callRegion === "sg"
                            ? "Singapore"
                            : m.callRegion === "us"
                              ? "US"
                              : m.callRegion === "gb"
                                ? "UK"
                                : "Every region"}
                        </span>
                      )}
                    </td>
                    {/* What they are working, and how near the end of it they
                        are. Answers "why is this person's screen empty" here,
                        rather than by opening every card on Call lists, and
                        "who needs leads on Monday" before they run out on
                        Friday. Assigned on Call lists; this only shows it.

                        The bar is `listProgress`, the same arithmetic the card
                        on Call lists draws, so the two cannot report one list
                        at two percentages. "Never rung" turns red at zero:
                        that caller has nothing new to dial, whatever the bar
                        says about retries still owed. */}
                    <td className="px-4 py-2.5">
                      {listsOf(m.id).length > 0 ? (
                        <div className="flex min-w-52 max-w-72 flex-col gap-1.5">
                          {listsOf(m.id).map((l) => {
                            const pct = Math.round(l.fraction * 100);
                            return (
                              <Link
                                key={l.id}
                                href={`/calls/${l.id}`}
                                title={`${l.total} leads · ${l.leftToCall} left to call · ${l.uncalled} never rung`}
                                className="block rounded-md border px-2 py-1.5 transition-colors hover:bg-muted/60"
                              >
                                <span className="flex items-baseline justify-between gap-2">
                                  <span className="truncate text-[12px] font-semibold">
                                    {l.name}
                                  </span>
                                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                                    {pct}%
                                  </span>
                                </span>
                                {/* Decoration over a percentage already written
                                    beside it, so it is not announced twice —
                                    the rule the "By list" bar on Stats uses. */}
                                <span
                                  aria-hidden
                                  className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10"
                                >
                                  <span
                                    className="block h-full rounded-full bg-primary"
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                                  {/* An empty list is not a caller who has run
                                      out of new leads, it is a list nothing was
                                      ever imported into — and red on it sends
                                      somebody hunting for the wrong problem. */}
                                  {l.total === 0 ? (
                                    "nothing imported into it yet"
                                  ) : (
                                    <>
                                      {l.leftToCall} left to call ·{" "}
                                      {l.uncalled === 0 ? (
                                        <span className="font-semibold text-destructive">
                                          no new leads
                                        </span>
                                      ) : (
                                        <>{l.uncalled} never rung</>
                                      )}
                                    </>
                                  )}
                                </span>
                              </Link>
                            );
                          })}
                          {/* The total, under the lists it adds up. Asked for
                              after somebody handed a caller two lists and read
                              the warning as unchanged: the per-list numbers
                              never said what he had between them, and the only
                              place the total appeared was the warning he was
                              trying to clear. The days are the warning's own
                              arithmetic at their own pace — the fastest caller
                              on the floor needs the most leads to look safe,
                              and that is worth being able to see on the row
                              rather than inferring it from an alarm. */}
                          <LeadTotal
                            lists={listsOf(m.id)}
                            perDay={pace[m.id] ?? 0}
                          />
                          {/* Under their lists rather than in the row menu:
                              the decision is made while reading the bars
                              above it, and a menu hides it behind a click at
                              the far end of a thirteen-column row.

                              Hidden rather than disabled when there is nothing
                              to give: a row of "Nothing left to give" against
                              every name is noise, and the warning above says
                              it once, where it matters. */}
                          {canManage && m.active && pool.length > 0 && (
                            <AssignListMenu
                              className="self-start"
                              person={{ id: m.id, name: m.name }}
                              pool={pool}
                              theirLists={listsOf(m.id).map((l) => l.name)}
                              market={m.callRegion}
                              label="Give them another"
                            />
                          )}
                        </div>
                      ) : m.active && isFloor(m.role) ? (
                        <div className="flex min-w-52 max-w-72 flex-col items-start gap-1.5">
                          <span className="whitespace-nowrap text-[12px] font-semibold text-destructive">
                            None yet, so their screen is empty
                          </span>
                          {canManage ? (
                            <AssignListMenu
                              className="self-start"
                              person={{ id: m.id, name: m.name }}
                              pool={pool}
                              theirLists={[]}
                              market={m.callRegion}
                            />
                          ) : (
                            <Link
                              href="/calls"
                              className="whitespace-nowrap text-[12px] font-semibold underline-offset-4 hover:underline"
                            >
                              Assign on Call lists
                            </Link>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.dialMethod}
                          disabled={busyId === m.id}
                          onValueChange={(v) => patch(m, { dialMethod: v })}
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="browser">The CRM</SelectItem>
                            <SelectItem value="handset">Own phone</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.dialMethod === "handset" ? "Own phone" : "The CRM"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.telnyxDid ?? (numbersFor(m.callRegion).length ? NO_DID : "")}
                          disabled={
                            busyId === m.id ||
                            m.dialMethod === "handset" ||
                            // Nothing to pick is not the same as a broken
                            // control: an empty dropdown with no explanation
                            // reads as one, so it says what is missing.
                            (!m.telnyxDid && numbersFor(m.callRegion).length === 0)
                          }
                          onValueChange={(v) => {
                            // Sharing a number is allowed — a demo line one
                            // person also dials from is a real thing to want —
                            // but never by accident, and never without the
                            // inbound half being said out loud. It is the part
                            // that silently breaks.
                            const held =
                              v === NO_DID ? null : holderOf(v, m.id);
                            if (
                              held &&
                              !confirm(
                                `${v} is already ${held.name}'s caller ID.\n\n` +
                                  `Give it to ${m.name} as well?\n\n` +
                                  `Both would dial out from it, and an inbound call to it can only ring one of them: whichever the CRM finds first. Pick a free number instead unless you mean to share.`,
                              )
                            ) {
                              return;
                            }
                            patch(m, { telnyxDid: v === NO_DID ? "" : v });
                          }}
                        >
                          <SelectTrigger size="sm" className="w-44">
                            <SelectValue
                              placeholder={
                                m.dialMethod === "handset"
                                  ? "Own phone"
                                  : m.callRegion
                                    ? `No ${MARKET_LABEL[m.callRegion]} numbers`
                                    : // Every market, so this is only ever
                                      // reached when the account itself has
                                      // no free number left to give.
                                      "No numbers free"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_DID}>Not assigned</SelectItem>
                            {m.telnyxDid &&
                              !numbersFor(m.callRegion).includes(m.telnyxDid) && (
                                <SelectItem value={m.telnyxDid}>
                                  {m.telnyxDid}
                                </SelectItem>
                              )}
                            {offerFor(m.callRegion, m.id).map((n) => {
                              const held = holderOf(n, m.id);
                              return (
                                <SelectItem key={n} value={n}>
                                  {n}
                                  {/* Never hidden, only labelled: an admin
                                      moving a number between two people has to
                                      be able to see the one they are moving. */}
                                  {held && (
                                    <span className="text-muted-foreground">
                                      in use by {held.name}
                                    </span>
                                  )}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.dialMethod === "handset"
                            ? "n/a"
                            : (m.telnyxDid ?? "Not assigned")}
                        </span>
                      )}
                    </td>
                    {/* An admin's row says "Always" rather than offering a
                        switch: `canUseKeypad` never reads the column for them,
                        so a toggle here would look like it did something. */}
                    {/* How they prefer to be paid. Free text rather than a
                        set of options: it holds a PayNow number, a bank and
                        account, or a Wise link, and any list would be wrong
                        within a month. Read on Payroll when recording a
                        payout, which is the moment somebody needs it. */}
                    <td className="px-4 py-2.5">
                      {canManage ? (
                        <PaymentMethodCell
                          value={m.paymentMethod}
                          busy={busyId === m.id}
                          onSave={(v) => patch(m, { paymentMethod: v })}
                        />
                      ) : (
                        <span className="text-muted-foreground">
                          {m.paymentMethod || "-"}
                        </span>
                      )}
                    </td>
                    {/* The three permissions in one cell, each labelled where
                        it sits. They were three columns of a single word, and
                        the word did not say which permission it was — so
                        granting texting meant scrolling right until the name
                        was gone, then scrolling up to read the heading. A
                        toggle whose meaning lives in a heading twelve columns
                        away is a toggle you have to go and look up. */}
                    <td className="whitespace-nowrap px-4 py-2.5 align-top">
                      <span className="flex flex-wrap items-center gap-1">
                        <PermissionToggle
                          label="Keypad"
                          /* Admins have it by being admins: `canUseKeypad`
                             never reads the column for them. */
                          always={m.role === "admin"}
                          on={m.keypadAccess}
                          canManage={canManage}
                          busy={busyId === m.id}
                          onToggle={() =>
                            patch(
                              m,
                              { keypadAccess: !m.keypadAccess },
                              `Keypad ${m.keypadAccess ? "taken away from" : "granted to"} ${m.name}.`,
                            )
                          }
                        />
                        <PermissionToggle
                          label="Hints"
                          /* No "always" for admins here, unlike the other two:
                             this is a feature under test that can put a wrong
                             suggestion in front of a caller mid-call, so
                             everybody opts in deliberately, founders
                             included. */
                          on={m.liveHints}
                          canManage={canManage}
                          busy={busyId === m.id}
                          onToggle={() =>
                            patch(
                              m,
                              { liveHints: !m.liveHints },
                              `Hints ${m.liveHints ? "switched off for" : "switched on for"} ${m.name}.`,
                            )
                          }
                        />
                        <PermissionToggle
                          label="Texting"
                          /* Founders could text before this permission
                             existed, so it does not take that away. Everyone
                             else is off until granted: a text reaches a
                             prospect from the number they ring back, costs
                             money per segment, and cannot be unsent. Reading
                             the Texts screen is not controlled here and never
                             was. */
                          always={m.role === "admin"}
                          on={m.textAccess}
                          canManage={canManage}
                          busy={busyId === m.id}
                          onToggle={() => {
                            // Granting now links their number to the live SMS
                            // campaign on Telnyx, not just a database column —
                            // worth a pause before it fires, the same reason
                            // sharing a caller ID above gets one. Taking it
                            // away is the tidy-up and needs no confirming.
                            if (
                              !m.textAccess &&
                              !confirm(
                                `Give ${m.name} texting?\n\n` +
                                  `This links ${m.telnyxDid ?? "their number"} to the SMS campaign on Telnyx so it can send, not just receive. It costs money per segment and cannot be unsent. Takes a few minutes to finish on Telnyx's side.`,
                              )
                            ) {
                              return;
                            }
                            patch(
                              m,
                              { textAccess: !m.textAccess },
                              `Texting ${m.textAccess ? "taken away from" : "granted to"} ${m.name}.`,
                            );
                          }}
                        />
                      </span>
                    </td>
                    {/* How much work, and how recently. One answer, so one
                        cell — "250" and "Sep 21" were two columns saying the
                        same thing about the same person. */}
                    <td className="whitespace-nowrap px-4 py-2.5 text-right align-top">
                      <span className="block font-semibold tabular-nums">
                        {m.calls.toLocaleString()}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {fmt(m.lastDialedAt, tz) ?? "Never dialled"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {canManage && (
                        <span className="flex justify-end gap-1">
                          {/* Shown or not, the API refuses it; this just stops
                              offering an action that cannot be taken. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => setRenaming(m)}
                          >
                            <Pencil data-icon="inline-start" />
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => setResetting(m)}
                          >
                            <KeyRound data-icon="inline-start" />
                            Password
                          </Button>
                          {/* Demotion only. Promoting from here was a
                              one-click handover of every account including
                              your own, sitting in the row next to Rename, and
                              the floor is staffed — nobody needs elevating.
                              Demotion stays because it takes privilege away,
                              and a new admin is still made deliberately, by
                              adding one with the role set. */}
                          {m.role === "admin" && (!m.isOwner || iAmOwner) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => {
                              // Quietly large in this direction too: it takes
                              // away screens someone may be halfway through.
                              if (
                                !window.confirm(
                                  `Make ${m.name} a caller?\n\nThey lose Stats and Team. Their calls, niches and numbers stay.`,
                                )
                              ) {
                                return;
                              }
                              patch(m, { role: "caller" });
                            }}
                          >
                            Make caller
                          </Button>
                          )}
                          {/* Closing is handed out and taken back here, one
                              step either way. Unlike making an admin this
                              grants nothing beyond the meetings a founder then
                              assigns them, so it sits on the row rather than
                              being reserved for Add person. */}
                          {isFloor(m.role) && m.active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              disabled={busyId === m.id}
                              onClick={() => {
                                const toCloser = m.role === "caller";
                                if (
                                  !window.confirm(
                                    toCloser
                                      ? `Make ${m.name} a closer?\n\nThey keep calling as now. They can also read Closing the Demo, and log what happened, draft contracts and log follow-ups on the meetings you assign them on Meetings.`
                                      : `Make ${m.name} a caller again?\n\nThey lose Closing the Demo and closing their assigned meetings. The meetings stay assigned until you change them.`,
                                  )
                                ) {
                                  return;
                                }
                                patch(m, { role: toCloser ? "closer" : "caller" });
                              }}
                            >
                              <Handshake data-icon="inline-start" />
                              {m.role === "caller" ? "Make closer" : "Make caller"}
                            </Button>
                          )}
                          {/* For when a caller leaves: one step that hands their
                              number, line, call lists, missed calls and texts to
                              the new person and switches them off. Callers only,
                              and only while active — see the replace route. */}
                          {isFloor(m.role) && m.active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              disabled={busyId === m.id}
                              onClick={() => setReplacing(m)}
                            >
                              <UserRound data-icon="inline-start" />
                              Replace
                            </Button>
                          )}
                          {(!m.isOwner || iAmOwner) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7", m.active && "text-destructive")}
                            disabled={busyId === m.id}
                            onClick={() => {
                              if (
                                m.active &&
                                !window.confirm(
                                  `Switch off ${m.name}?\n\nThey are signed out and cannot log back in. Their calls, niches and numbers all stay, and switching them on again restores everything.`,
                                )
                              ) {
                                return;
                              }
                              patch(m, { active: !m.active });
                            }}
                          >
                            {m.active ? "Switch off" : "Switch on"}
                          </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
              {off > 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setShowOff((v) => !v)}
                      className="text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {showOff
                        ? `Hide ${off} switched off`
                        : `Show ${off} switched off`}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Neither dialog closes itself on success: each swaps its form for the
          sign-in details to hand over, and closing it is the admin's call. */}
      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={() => router.refresh()}
        offer={(region) => offerFor(region, -1)}
        holderName={(phone) => holderOf(phone, -1)?.name ?? null}
      />

      <ReplaceDialog
        member={replacing}
        listCount={listsOf(replacing?.id ?? -1).length}
        onOpenChange={(open) => !open && setReplacing(null)}
        onReplaced={() => router.refresh()}
      />

      <RenameDialog
        member={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSaved={async (name) => {
          const member = renaming;
          if (!member) return;
          if (await patch(member, { name })) {
            setRenaming(null);
            toast.success(`Now shown as ${name}.`);
          }
        }}
      />

      <ResetPasswordDialog
        member={resetting}
        onOpenChange={(open) => !open && setResetting(null)}
        onSaved={async (password) => {
          const member = resetting;
          if (!member) return;
          const ok = await patch(member, { password });
          if (ok) {
            setResetting(null);
            toast.success(`New password set for ${member.name}.`);
          }
        }}
      />
    </div>
  );
}

/**
 * A password somebody can read out over a call without spelling it twice:
 * lowercase letters and digits with the lookalikes (l, 1, o, 0, i) left out.
 * Ten characters from 31 is about 50 bits, plenty behind a login that also
 * needs the username.
 */
function newPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** "Wei Ling" → "weiling": what someone types on a phone at 9am. */
const usernameFrom = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The name, username and password fields both dialogs ask for.
 *
 * The username follows the name until it is edited by hand, and the password
 * starts filled in with one that can be read out, so the common case is typing
 * a name and pressing the button.
 */
function useLoginFields(open: boolean) {
  const [name, setName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [touchedUsername, setTouchedUsername] = React.useState(false);
  const [password, setPassword] = React.useState("");

  // Reset each time the dialog opens rather than when it closes, so the
  // handover card can go on showing what was just made after the form is done.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setUsername("");
      setTouchedUsername(false);
      setPassword(newPassword());
    }
  }

  return {
    name,
    username,
    password,
    setName: (v: string) => {
      setName(v);
      if (!touchedUsername) setUsername(usernameFrom(v));
    },
    setUsername: (v: string) => {
      setTouchedUsername(true);
      setUsername(v.toLowerCase());
    },
    setPassword,
    regenerate: () => setPassword(newPassword()),
    valid: Boolean(name.trim()) && username.length >= 2 && password.length >= 8,
  };
}

function LoginFields({
  fields,
  idPrefix,
}: {
  fields: ReturnType<typeof useLoginFields>;
  idPrefix: string;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={fields.name}
          onChange={(e) => fields.setName(e.target.value)}
          placeholder="Wei Ling"
          autoFocus
        />
        <p className="text-[11px] text-muted-foreground">
          What the stats screen will call them.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-username`}>Username</Label>
          <Input
            id={`${idPrefix}-username`}
            value={fields.username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => fields.setUsername(e.target.value)}
            placeholder="weiling"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-password`}>Password</Label>
          <div className="flex gap-1.5">
            <Input
              id={`${idPrefix}-password`}
              value={fields.password}
              onChange={(e) => fields.setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={fields.regenerate}
            >
              New
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * What to give the person who was just set up, with one button to copy it.
 *
 * Shown in place of the form rather than as a toast: this is the only time the
 * password is ever on screen, and a toast is gone before anybody has opened
 * WhatsApp to send it.
 */
function HandOver({
  title,
  name,
  username,
  password,
  details,
  warning,
  onClose,
}: {
  title: string;
  name: string;
  username: string;
  password: string;
  details: string[];
  warning?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = `Sign in at ${typeof window === "undefined" ? "" : window.location.origin}\nUsername: ${username}\nPassword: ${password}`;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Send {name} these. This is the only time the password is shown: if it
          gets lost, set a new one from their row.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border bg-muted/40 p-3 font-mono text-[13px] leading-6">
        <div>
          <span className="text-muted-foreground">Username </span>
          <span className="font-bold">{username}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Password </span>
          <span className="font-bold">{password}</span>
        </div>
      </div>
      {details.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {warning && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
          {warning}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              toast.error("Could not copy: select the details and copy them.");
            }
          }}
        >
          {copied ? "Copied" : "Copy sign-in details"}
        </Button>
      </DialogFooter>
    </>
  );
}

const MARKETS = [
  { value: "us", label: "US" },
  { value: "sg", label: "Singapore" },
  { value: "gb", label: "UK" },
  { value: "all", label: "Every region" },
];

const NO_NUMBER = "__none__";

function AddPersonDialog({
  open,
  onOpenChange,
  onAdded,
  offer,
  holderName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  /** Free numbers first, for a market; null is every market. */
  offer: (region: string | null) => string[];
  /** Who already rings from a number, if anybody. */
  holderName: (phone: string) => string | null;
}) {
  const fields = useLoginFields(open);
  const [role, setRole] = React.useState<Role>("caller");
  const [market, setMarket] = React.useState("us");
  const [dialMethod, setDialMethod] = React.useState<"browser" | "handset">(
    "browser",
  );
  const [number, setNumber] = React.useState(NO_NUMBER);
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<{
    name: string;
    username: string;
    password: string;
    details: string[];
    warning?: string;
  } | null>(null);

  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRole("caller");
      setMarket("us");
      setDialMethod("browser");
      setNumber(NO_NUMBER);
      setDone(null);
    }
  }

  const region = market === "all" ? null : market;
  const numbers = offer(region);
  // A number that stopped fitting because the market changed is dropped, not
  // silently sent for the API to refuse.
  const picked =
    number !== NO_NUMBER && numbers.includes(number) && dialMethod === "browser"
      ? number
      : null;
  const pickedHolder = picked ? holderName(picked) : null;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name,
          username: fields.username,
          password: fields.password,
          role,
          callRegion: region,
          dialMethod,
          telnyxDid: picked ?? "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not add that person.");
        return;
      }
      const details = [
        data.number
          ? `Calls go out from ${data.number}, and calls to it ring them in the CRM.`
          : dialMethod === "handset"
            ? "They dial from their own phone."
            : "No number yet: pick one on their row when there is one free.",
        isFloor(role)
          ? "Next: give them call lists on Call lists, or their screen will be empty."
          : "They can manage the team.",
      ];
      setDone({
        name: fields.name.trim(),
        username: data.username ?? fields.username,
        password: fields.password,
        details,
        warning: data.lineWarning,
      });
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {done ? (
          <HandOver
            title={`${done.name} is set up`}
            name={done.name}
            username={done.username}
            password={done.password}
            details={done.details}
            warning={done.warning}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add someone to the team</DialogTitle>
              <DialogDescription>
                This makes their login and, if you pick a number, their phone
                line: they can dial and be rung back as soon as they sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <LoginFields fields={fields} idPrefix="add" />
              {/* Full-width triggers, so the dropdowns line up with the text
                  boxes above rather than shrinking to their contents. */}
              <div className="grid gap-3 sm:grid-cols-2 [&_button]:w-full">
                <div className="grid gap-1.5">
                  <Label htmlFor="add-role">Role</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => setRole(v as Role)}
                  >
                    <SelectTrigger id="add-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="caller">Caller</SelectItem>
                      <SelectItem value="closer">Closer</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-market">Market</Label>
                  <Select value={market} onValueChange={setMarket}>
                    <SelectTrigger id="add-market">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-dials">Dials with</Label>
                  <Select
                    value={dialMethod}
                    onValueChange={(v) => setDialMethod(v as "browser" | "handset")}
                  >
                    <SelectTrigger id="add-dials">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="browser">The CRM</SelectItem>
                      <SelectItem value="handset">Own phone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-number">Their number</Label>
                  <Select
                    value={picked ?? NO_NUMBER}
                    onValueChange={setNumber}
                    disabled={dialMethod === "handset"}
                  >
                    <SelectTrigger id="add-number">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_NUMBER}>
                        {dialMethod === "handset" ? "Own phone" : "No number yet"}
                      </SelectItem>
                      {numbers.map((n) => {
                        const held = holderName(n);
                        return (
                          <SelectItem key={n} value={n}>
                            {n}
                            {held && (
                              <span className="text-muted-foreground">
                                in use by {held}
                              </span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {pickedHolder ? (
                <p className="text-[12px] text-destructive">
                  {pickedHolder} already uses {picked}. Calls to it will ring{" "}
                  {fields.name.trim() || "this person"} instead. If{" "}
                  {pickedHolder} is leaving, use Replace on their row, which
                  moves their call lists too.
                </p>
              ) : dialMethod === "browser" && numbers.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  No {region ? MARKET_LABEL[region] : ""} numbers on the account.
                  They can still sign in; give them one later from their row.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || !fields.valid}>
                {saving ? (picked ? "Setting up their line…" : "Adding…") : "Add person"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Replace a caller who is leaving.
 *
 * Says what moves and what stays before anything happens, in plain words, and
 * afterwards shows the new login to hand over and what actually moved. See
 * `/api/users/[id]/replace` for the rules.
 */
function ReplaceDialog({
  member,
  listCount,
  onOpenChange,
  onReplaced,
}: {
  member: TeamMember | null;
  /** How many call lists they hold — passed in rather than read off `member`,
   *  which stopped carrying them when the Team screen moved to `getCallLists`
   *  for the progress bars. */
  listCount: number;
  onOpenChange: (open: boolean) => void;
  onReplaced: () => void;
}) {
  const open = member !== null;
  const fields = useLoginFields(open);
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<{
    name: string;
    username: string;
    password: string;
    details: string[];
    warning?: string;
  } | null>(null);
  // The member is kept once the replacement is made, because the list refresh
  // that follows switches them off and the card still needs their name.
  const [who, setWho] = React.useState<TeamMember | null>(member);
  if (member && member !== who) {
    setWho(member);
    setDone(null);
  }

  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  async function submit() {
    if (!who) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${who.id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name,
          username: fields.username,
          password: fields.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not replace them.");
        return;
      }
      const name = fields.name.trim();
      const m = data.moved ?? { lists: 0, missedCalls: 0, texts: 0 };
      setDone({
        name,
        username: data.username ?? fields.username,
        password: fields.password,
        details: [
          data.number
            ? `${data.number} now rings ${name}, and calls go out from it.`
            : `${who.name} had no number, so ${name} has none yet.`,
          m.lists > 0
            ? `${plural(m.lists, "call list", "call lists")} moved, with their callbacks.`
            : `${who.name} had no call lists: give ${name} some on Call lists.`,
          ...(m.missedCalls > 0
            ? [`${plural(m.missedCalls, "missed call", "missed calls")} to ring back moved.`]
            : []),
          ...(m.texts > 0 ? [`${plural(m.texts, "text", "texts")} to the number moved.`] : []),
          `${who.name} is switched off. Their calls and pay history stay under their name.`,
        ],
        warning: data.lineWarning,
      });
      onReplaced();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {done ? (
          <HandOver
            title={`${done.name} has taken over from ${who?.name}`}
            name={done.name}
            username={done.username}
            password={done.password}
            details={done.details}
            warning={done.warning}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Replace {who?.name}</DialogTitle>
              <DialogDescription>
                For when somebody leaves. The new person picks up exactly where{" "}
                {who?.name} left off.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <LoginFields fields={fields} idPrefix="replace" />
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-[13px] sm:grid-cols-2">
                <div>
                  <p className="font-bold">Moves to the new person</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    <li>
                      {who?.telnyxDid
                        ? `Their number, ${who.telnyxDid}, and phone line`
                        : "Their phone line, if they have one"}
                    </li>
                    <li>
                      {listCount > 0
                        ? `${plural(listCount, "call list", "call lists")} and the callbacks on them`
                        : "Their call lists (they have none)"}
                    </li>
                    <li>Missed calls still to ring back</li>
                    <li>Texts to their number</li>
                    <li>Market, dialling and Keypad settings</li>
                  </ul>
                </div>
                <div>
                  <p className="font-bold">Stays with {who?.name}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    <li>The calls they made, on Stats</li>
                    <li>Their pay and payouts</li>
                    <li>Their account, switched off</li>
                  </ul>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || !fields.valid}>
                {saving ? "Handing over…" : `Replace ${who?.name ?? ""}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change the name the stats show.
 *
 * The username is deliberately not editable: it is what somebody types every
 * morning and what the calls were logged under in the logs, and renaming it
 * would silently break a saved password manager entry for no gain. A wrong
 * username is fixed by making a new account.
 */
function RenameDialog({
  member,
  onOpenChange,
  onSaved,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (member) setName(member.name);
  }, [member]);

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {member?.name}</DialogTitle>
          <DialogDescription>
            What the stats and the spreadsheet's Called by column show. They
            still sign in as{" "}
            <span className="font-semibold">{member?.username}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="rename-name">Name</Label>
          <Input
            id="rename-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSaved(name.trim())} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  onOpenChange,
  onSaved,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (password: string) => void;
}) {
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (member) setPassword("");
  }, [member]);

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New password for {member?.name}</DialogTitle>
          <DialogDescription>
            Their old one stops working straight away. Any session they already
            have open stays signed in until it expires: switch the account off
            if you need them out now.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reset-password">Password</Label>
          <Input
            id="reset-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSaved(password)}
            disabled={password.length < 8}
          >
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The payment method cell: a text box that saves on blur or Enter.
 *
 * Kept as its own component so each row holds its own draft — one piece of
 * state in the parent would make every row share a value, and typing in one
 * would fill in the rest.
 *
 * Saves only when the value actually changed, so tabbing through the table
 * does not fire a PATCH per row.
 */
function PaymentMethodCell({
  value,
  busy,
  onSave,
}: {
  value: string | null;
  busy: boolean;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(value ?? "");
  // Server data wins whenever the row refreshes — the same re-sync
  // `telnyx-numbers.tsx` does from its props, but adjusted during render
  // rather than in an effect. React handles a setState in the render phase by
  // restarting this component before anything commits, where the effect
  // version renders once with the stale value and then again with the fresh
  // one. It is also the pattern the lint rule those other call sites trip is
  // pointing at.
  const [synced, setSynced] = React.useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value ?? "");
  }

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    onSave(next || null);
  };

  return (
    <Input
      value={draft}
      disabled={busy}
      placeholder="PayNow, bank, link…"
      className="h-8 w-44 text-[13px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value ?? "");
      }}
    />
  );
}
