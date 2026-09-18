import Link from "next/link";
import { ChevronRight, Lock, PhoneCall } from "lucide-react";
import {
  getCallLists,
  MAX_UNANSWERED_TRIES,
  type CallListSummary,
} from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";
import { callerNumberOf, listTeam, statsRegionOf } from "@/lib/users";
import { spokenNumber } from "@/lib/phone";
import {
  getCallTotals,
  statsZone,
  todayInStatsTz,
} from "@/lib/call-stats";
import { PageShell } from "@/components/page-shell";
import { DailyReportCard } from "@/components/calls/slack-post";
import { YourNumber } from "@/components/calls/your-number";
import { CallImportDialog } from "@/components/calls/call-import-dialog";
import { SameBusinessReview } from "@/components/calls/same-business-review";
import { ListAssignment } from "@/components/calls/list-assignment";
import { ListActions } from "@/components/calls/list-actions";
import { ListRegion } from "@/components/calls/list-region";
import { WorkGateBanner } from "@/components/calls/work-gate";
import { getWorkOrder } from "@/lib/work-order";
import { REGION_LABELS, REGION_ORDER } from "@/components/calls/region";
import { ListSortPicker } from "@/components/calls/list-sort-picker";
import { ListFilters } from "@/components/calls/list-filters";
import { listProgress, sortLists } from "@/lib/list-sort";
import {
  applyListFilters,
  listFilterQuery,
  parseListFilters,
} from "@/lib/list-filter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    mine?: string;
    sort?: string;
    q?: string;
    owner?: string;
    market?: string;
    stage?: string;
  }>;
}) {
  const me = await getCurrentUser();
  const isAdmin = me?.role === "admin";
  const [params, all, team] = await Promise.all([
    searchParams,
    // A caller is only ever handed their own niches; the filters below are an
    // admin convenience on top of the full set.
    getCallLists(callScope(me), (await readerZone(me?.id)).tz),
    listTeam(),
  ]);

  // Missed calls, then callbacks, then these. Said here as well as enforced on
  // the dialler: finding out a card is locked by pressing it teaches the rule
  // worse than being told before the press.
  const work = await getWorkOrder(me);

  // Search, whose lists, market and progress, for the founders. A caller is
  // handed a couple of niches and gets only the order: a filter bar over two
  // cards is furniture. See `lib/list-filter.ts`.
  const parsed = parseListFilters(params);
  const filters = isAdmin
    ? parsed
    : { ...parsed, q: "", owner: "any" as const, market: "any" as const, stage: "all" as const };
  // Filtered, then sorted, then cut into folders, so every folder keeps the
  // chosen order. See `lib/list-sort.ts` for why niche is the default.
  const lists = sortLists(
    applyListFilters(all, filters, me?.id ?? null),
    filters.sort,
  );
  const people = team.map((t) => ({ id: t.id, name: t.name, active: t.active }));
  // Who lists can be narrowed to: everyone working, plus anyone switched off
  // who still holds a list, so those can be found and handed on.
  const owners = team
    .filter((t) => t.active || all.some((l) => l.assignedUserId === t.id))
    .map((t) => ({ id: t.id, name: t.name, active: t.active }));
  const hasOwnLists = all.some((l) => l.assignedUserId === me?.id);
  const clearHref = `/calls${listFilterQuery({ ...filters, q: "", owner: "any", market: "any", stage: "all" })}`;

  // The end-of-session report, filled in. Callers only: the founders are who
  // it is posted to, so prompting them to file one would be a card asking
  // nobody for anything, the same reason they are off the Scoreboard.
  const report =
    me && me.role === "caller" ? await dailyReport(me.id, me.name) : null;

  // The number this person rings from, labelled where they start the day.
  // Callers always — "not assigned yet" is the answer that explains why their
  // script still says "[your number]", so hiding it would hide the diagnosis.
  // Admins only when they have one: an admin reading "ask an admin" is a card
  // pointing at itself, and Team is one click away for them anyway.
  const myNumber = await callerNumberOf(me?.id);
  const showNumber = me?.role === "caller" || myNumber !== null;

  // One section per market, plus whatever nobody has filed yet. Empty folders
  // are dropped rather than left as a heading with nothing under it, so the
  // screen never grows a section for a market you do not work.
  const folders: { key: string; label: string; lists: CallListSummary[] }[] = [
    ...REGION_ORDER.map((r) => ({
      key: r,
      label: REGION_LABELS[r],
      lists: lists.filter((l) => l.region === r),
    })),
    {
      key: "unfiled",
      label: "Unfiled",
      lists: lists.filter((l) => l.region === null),
    },
  ].filter((f) => f.lists.length > 0);

  return (
    <PageShell
      title="Call lists"
      actions={
        // Admins only. A caller is handed their niches; importing is not a
        // thing they do, and offering it invites a dead end.
        isAdmin ? (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <SameBusinessReview />
            <CallImportDialog
              callLists={all.map((l) => ({ id: l.id, name: l.name }))}
              people={people}
              canAssign={isAdmin}
            />
          </div>
        ) : undefined
      }
    >
      <div className="px-4 py-5 sm:px-6">
        {work.blockedBy && (
          <WorkGateBanner
            stage={work.blockedBy}
            count={
              work.blockedBy === "missed" ? work.missed : work.callbacks
            }
            className="mb-4"
          />
        )}
        {showNumber && (
          <YourNumber number={myNumber ? spokenNumber(myNumber) : null} />
        )}
        {report && (
          <DailyReportCard
            name={report.name}
            date={report.date}
            calls={report.calls}
            pickups={report.pickups}
            demos={report.demos}
            zoneName={report.zoneName}
          />
        )}
        {/* The founders' bar replaces the Mine/Everyone toggle that used to sit
            in the header: "Mine" is one of its caller choices now. */}
        {isAdmin && all.length > 0 && (
          <ListFilters
            filters={filters}
            owners={owners}
            canPickMine={hasOwnLists}
            shown={lists.length}
            total={all.length}
          />
        )}
        {!isAdmin && lists.length > 2 && (
          <div className="mb-3 flex justify-end">
            <ListSortPicker value={filters.sort} mine={null} />
          </div>
        )}
        {all.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <PhoneCall
              className="mx-auto size-6 text-muted-foreground"
              strokeWidth={1.6}
            />
            <p className="mt-3 text-sm font-semibold">
              {isAdmin ? "No call lists yet." : "Nothing assigned to you yet."}
            </p>
            {/* A caller cannot fix this themselves, so they are told what is
                actually happening rather than given an instruction they have
                no permission to follow. */}
            <p className="mt-1 text-[13px] text-muted-foreground">
              {isAdmin
                ? "Import a CSV with a phone column to start calling."
                : "Your niches will appear here once an admin assigns them. Ask for more when you run out."}
            </p>
          </div>
        ) : lists.length === 0 ? (
          // Filtered down to nothing. Said as that, with the way back, rather
          // than the "no call lists yet" above, which would read as the lists
          // having gone.
          <div className="rounded-xl border border-dashed py-12 text-center">
            <p className="text-sm font-semibold">No lists match these filters.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Try another caller, market or progress.
            </p>
            <Link
              href={clearHref}
              scroll={false}
              className="mt-3 inline-block text-[13px] font-semibold underline-offset-4 hover:underline"
            >
              Clear filters
            </Link>
          </div>
        ) : isAdmin ? (
          // Folders, for the only people who see more than a handful of
          // lists. A caller is handed their own niches, so grouping those
          // would be headings over two cards - they get the flat grid below.
          <div className="flex flex-col gap-5">
            {folders.map((f) => (
              // Native <details> so this stays a server component and an open
              // folder survives a refresh with no state to keep. Open by
              // default: the point is seeing the lists, not hiding them.
              <details key={f.key} open className="group/folder">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open/folder:rotate-90"
                  />
                  <span className="text-sm font-extrabold tracking-[-0.01em]">
                    {f.label}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {f.lists.length}
                  </span>
                </summary>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {f.lists.map((l) => (
                    <ListCard
                      key={l.id}
                      l={l}
                      people={people}
                      isAdmin={isAdmin}
                      locked={work.blockedBy !== null}
                    />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {lists.map((l) => (
              <ListCard
                key={l.id}
                l={l}
                people={people}
                isAdmin={isAdmin}
                locked={work.blockedBy !== null}
              />
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}

/**
 * This caller's day so far, for the post the SOP asks them to make.
 *
 * Counted exactly as the Scoreboard counts it: the same `getCallTotals`, the
 * same day boundary, the same zone this person has chosen for their reporting
 * screens. Two ways of counting a day would put two different numbers in front
 * of one caller, and the one they type into Slack had better be the one their
 * numbers are read from.
 *
 * Nothing is shown before the first call of the day. A card reporting zero
 * calls at nine in the morning is not a reminder, it is furniture, and the
 * point of this one is that it appears when there is something to say.
 */
async function dailyReport(userId: number, name: string) {
  const zone = statsZone(await statsRegionOf(userId));
  const date = todayInStatsTz(zone.tz);
  const totals = await getCallTotals(
    { kind: "day", date, tz: zone.tz },
    undefined,
    userId,
  );
  if (totals.calls === 0) return null;
  return {
    name,
    // Fixed locale and zone, formatted on the server and passed down as a
    // string: a date built in the browser renders one way on the server and
    // another on hydration, which is the trap the spreadsheet documents.
    date: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: zone.tz,
    }).format(new Date()),
    calls: totals.calls,
    pickups: totals.pickups,
    demos: totals.demos,
    zoneName: zone.name,
  };
}

/**
 * One niche, as a card.
 *
 * Lifted out of the page so it can be rendered inside a folder as well as in
 * the flat grid, without the markup existing twice and drifting apart.
 */
function ListCard({
  l,
  people,
  isAdmin,
  locked = false,
}: {
  l: CallListSummary;
  people: { id: number; name: string; active: boolean }[];
  isAdmin: boolean;
  /** Missed calls or callbacks are owed, so the queue behind this card is
   *  shut. Rendered as a card that is plainly not a link rather than one that
   *  looks live and then refuses — the banner above says why. */
  locked?: boolean;
}) {
  // The bar tracks the queue emptying, not leads touched once.
  // "35 of 40 worked" over a screen that then asked for 21 more
  // calls was two different questions wearing the same sentence:
  // a lead rung and not reached is still work.
  // Shared with the sort, so "most done first" orders by this very bar.
  const { leftToCall, done, fraction } = listProgress(l);
  const pct = Math.round(fraction * 100);
  return (
    <li className="relative">
      {/* Over the card, not inside it — the card is one big link
          and a menu nested in an anchor navigates as it opens. */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {/* Admins only: a caller sees their own niches and has nothing to
            file. The folder is already visible from the heading this card
            sits under, so the chip is the control rather than the label. */}
        {isAdmin && <ListRegion listId={l.id} region={l.region} />}
        <ListAssignment
          listId={l.id}
          assignedName={l.assignedName}
          assignedUserId={l.assignedUserId}
          people={people}
          canManage={isAdmin}
        />
        {isAdmin && (
          <ListActions
            listId={l.id}
            name={l.name}
            leads={l.total}
            uncalled={l.uncalled}
            calls={l.callsLogged}
            people={people}
          />
        )}
      </div>
      <CardShell listId={l.id} locked={locked}>
        {/* Room for the controls pinned to that corner — without it a long
            niche name runs underneath them. Wider now there are two. */}
        <div className="flex items-start gap-2 pr-40">
          <div className="min-w-0">
            <p className="truncate font-bold tracking-[-0.01em]">
              {l.name}
            </p>
            {locked && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-destructive">
                <Lock className="size-3" strokeWidth={2.4} />
                Locked until the work above is done
              </p>
            )}
            {l.niche && (
              <p className="truncate text-[13px] text-muted-foreground">
                {l.niche}
              </p>
            )}
          </div>
        </div>
        {/* Moved out of the header row: the owner control now sits
            in that corner, and the two overlapped on a phone. */}
        {l.callbacksDue > 0 && (
          <div className="mt-2">
            <Badge>
              {l.callbacksDue} callback
              {l.callbacksDue === 1 ? "" : "s"} due
            </Badge>
          </div>
        )}

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {done} of {l.total} done
          </span>{" "}
          · {leftToCall} left to call · {l.uncalled} new touches
          {l.duplicates > 0 &&
            ` · ${l.duplicates} already on another list`}
        </p>
        {/* "24 called today" said nothing about whether anyone was
            spoken to. The three parts sum to the total, so the
            day reads as what it was. */}
        {l.calledToday > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Today: {l.calledToday}{" "}
            {l.calledToday === 1 ? "call" : "calls"} ·{" "}
            <span className="font-semibold text-foreground">
              {l.conversationsToday} spoke to someone
            </span>
            {l.noAnswerToday > 0 &&
              ` · ${l.noAnswerToday} no answer`}
            {l.badNumbersToday > 0 &&
              ` · ${l.badNumbersToday} bad ${
                l.badNumbersToday === 1 ? "number" : "numbers"
              }`}
          </p>
        )}

        {/* Each tag says what happened to a lead, not what stage
            a piece of jargon puts it in. "In progress" and
            "closed" said neither: closed counted a booked demo
            and a wrong number as the same thing. Tags with a zero
            are left off — a card should carry facts, not a grid
            of noughts. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {l.won > 0 && <Badge variant="default">{l.won} won</Badge>}
          {l.trials > 0 && (
            <Badge variant="default">{l.trials} in trial</Badge>
          )}
          {l.demoBooked > 0 && (
            <Badge variant="default">
              {l.demoBooked} {l.demoBooked === 1 ? "demo" : "demos"}
            </Badge>
          )}
          {l.toRetry > 0 && (
            <Badge variant="outline">{l.toRetry} to try again</Badge>
          )}
          {/* Done for today, but not finished: rung, not reached, and waiting
              for its next day. Said so the bar at full does not read as a
              list with nothing left in it. */}
          {l.retryLater > 0 && (
            <Badge variant="outline">{l.retryLater} back on a later day</Badge>
          )}
          {l.triedOut > 0 && (
            <Badge variant="outline">
              {l.triedOut} no answer after {MAX_UNANSWERED_TRIES} tries
            </Badge>
          )}
          {l.ruledOut > 0 && (
            <Badge variant="outline">{l.ruledOut} ruled out</Badge>
          )}
        </div>
      </CardShell>
    </li>
  );
}

/**
 * The card's outer element: a link normally, a plain box while the queue
 * behind it is shut.
 *
 * Split in two rather than a Link with a dead href, because the difference has
 * to be visible before the press — `h-full` is what keeps a row's bottom edges
 * level, so both carry it, and only the live one carries a hover state. A card
 * that lights up under the cursor and then refuses is the version of this that
 * gets read as a bug.
 */
function CardShell({
  listId,
  locked,
  children,
}: {
  listId: number;
  locked: boolean;
  children: React.ReactNode;
}) {
  const shell = "flex h-full flex-col rounded-xl border p-4";
  if (locked) {
    return (
      <div
        aria-disabled="true"
        className={cn(shell, "cursor-not-allowed border-dashed bg-muted/30")}
      >
        {children}
      </div>
    );
  }
  return (
    <Link
      href={`/calls/${listId}`}
      className={cn(shell, "bg-card transition-colors hover:bg-muted/40")}
    >
      {children}
    </Link>
  );
}
