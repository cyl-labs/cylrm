import Link from "next/link";
import { ChevronRight, PhoneCall } from "lucide-react";
import { getCallLists, type CallListSummary } from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";
import { listTeam, statsRegionOf } from "@/lib/users";
import {
  getCallTotals,
  statsZone,
  todayInStatsTz,
} from "@/lib/call-stats";
import { PageShell } from "@/components/page-shell";
import { DailyReportCard } from "@/components/calls/slack-post";
import { CallImportDialog } from "@/components/calls/call-import-dialog";
import { ListAssignment } from "@/components/calls/list-assignment";
import { ListActions } from "@/components/calls/list-actions";
import { ListRegion } from "@/components/calls/list-region";
import { REGION_LABELS, REGION_ORDER } from "@/components/calls/region";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const me = await getCurrentUser();
  const isAdmin = me?.role === "admin";
  const [{ mine: mineParam }, all, team] = await Promise.all([
    searchParams,
    // A caller is only ever handed their own niches; the filter below is an
    // admin convenience on top of the full set.
    getCallLists(callScope(me)),
    listTeam(),
  ]);

  const myLists = all.filter((l) => l.assignedUserId === me?.id);
  // Admins default to the whole floor — that is the job — and can narrow to
  // their own. Callers have nothing to narrow: `all` is already only theirs.
  const mine = isAdmin && mineParam === "1";
  const lists = mine ? myLists : all;
  const people = team.map((t) => ({ id: t.id, name: t.name, active: t.active }));

  // The end-of-session report, filled in. Callers only: the founders are who
  // it is posted to, so prompting them to file one would be a card asking
  // nobody for anything, the same reason they are off the Scoreboard.
  const report =
    me && me.role === "caller" ? await dailyReport(me.id, me.name) : null;

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
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {isAdmin && myLists.length > 0 && (
            // Two links rather than a control: the filter is in the URL, so
            // it survives a refresh and can be bookmarked.
            <div className="flex shrink-0 rounded-lg border p-0.5">
              {[
                { key: "1", label: "Mine", on: mine },
                { key: "0", label: "Everyone", on: !mine },
              ].map((t) => (
                <Link
                  key={t.key}
                  href={`/calls?mine=${t.key}`}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[13px] font-semibold transition-colors",
                    t.on
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          )}
          {/* Admins only. A caller is handed their niches; importing is not
              a thing they do, and offering it invites a dead end. */}
          {isAdmin && (
            <CallImportDialog
              callLists={all.map((l) => ({ id: l.id, name: l.name }))}
              people={people}
              canAssign={isAdmin}
            />
          )}
        </div>
      }
    >
      <div className="px-4 py-5 sm:px-6">
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
        {lists.length === 0 ? (
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
                    />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {lists.map((l) => (
              <ListCard key={l.id} l={l} people={people} isAdmin={isAdmin} />
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
}: {
  l: CallListSummary;
  people: { id: number; name: string; active: boolean }[];
  isAdmin: boolean;
}) {
  // The bar tracks the queue emptying, not leads touched once.
  // "35 of 40 worked" over a screen that then asked for 21 more
  // calls was two different questions wearing the same sentence:
  // a lead rung and not reached is still work.
  const leftToCall = l.uncalled + l.toRetry + l.callbacksDue;
  const done = l.total - leftToCall;
  const pct = l.total === 0 ? 0 : Math.round((done / l.total) * 100);
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
            calls={l.callsLogged}
            people={people}
          />
        )}
      </div>
      <Link
        href={`/calls/${l.id}`}
        // `h-full` is what keeps the row's bottom edges level. The
        // grid stretches the <li> to the tallest card in the row,
        // but the card is this <a>, which without it keeps its own
        // height and leaves the shorter one floating in dead
        // space. Cards differ in height honestly — a list with
        // calls against it carries tags and a callbacks badge that
        // an untouched one has nothing to put in — so they are
        // levelled rather than made identical.
        className="flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        {/* Room for the controls pinned to that corner — without it a long
            niche name runs underneath them. Wider now there are two. */}
        <div className="flex items-start gap-2 pr-40">
          <div className="min-w-0">
            <p className="truncate font-bold tracking-[-0.01em]">
              {l.name}
            </p>
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
          {l.ruledOut > 0 && (
            <Badge variant="outline">{l.ruledOut} ruled out</Badge>
          )}
        </div>
      </Link>
    </li>
  );
}
