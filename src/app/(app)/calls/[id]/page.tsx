import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, Table2 } from "lucide-react";
import {
  CALL_QUEUE_LIMIT,
  getCallList,
  countQueueSplit,
  getCallQueue,
  getSavedLines,
  type CallQueueFilter,
} from "@/lib/calls";
import { getDiallerSop } from "@/lib/sop";
import { callRegionOf, dialMethodOf } from "@/lib/users";
import { sopRegionFor } from "@/lib/calls";
import { PageShell } from "@/components/page-shell";
import { Dialler } from "@/components/calls/dialler";
import { cn } from "@/lib/utils";
import { callScope, getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const FILTERS: { key: CallQueueFilter; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "callbacks", label: "Callbacks" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const isFilter = (v: string | undefined): v is CallQueueFilter =>
  FILTERS.some((f) => f.key === v);

export default async function CallListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; open?: string }>;
}) {
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) notFound();

  const { view, open } = await searchParams;
  const filter: CallQueueFilter = isFilter(view) ? view : "queue";
  // Only leads it is business hours for, where they are.
  //
  // On by default since 2026-08-31. It shipped off, on the reasoning that a
  // filter hiding work should be asked for rather than assumed, and that was
  // the wrong trade for a floor calling the US from overseas: a third of those
  // leads are outside their own business hours at any moment, so the default
  // handed callers numbers that should not be rung and left them to notice.
  // The safe state is the one that cannot waste a dial or wake anybody up, and
  // the whole list is one tap away.
  //
  // "0" rather than the absence of the parameter is what turns it off, so a
  // link that says nothing about the filter gets the default rather than
  // silently disabling it.
  const callableNow = open !== "0";

  const me = await getCurrentUser();
  const list = await getCallList(listId, callScope(me));
  if (!list) notFound();

  // One market's script and objections, decided by who is signed in rather
  // than by the lead in front of them, so nothing switches mid-call.
  //
  // Falling back to the list's own market matters for anyone with no market
  // set, which is every admin: the library shows them both markets, but the
  // dialler can only show one script, and it showed none at all. A founder
  // opening a list to try the dialler got no script panel and no objection
  // drawer, which reads as the feature having disappeared.
  const dialMethod = await dialMethodOf(me?.id);
  const sopRegion =
    sopRegionFor(await callRegionOf(me?.id)) ?? sopRegionFor(list.region);
  const [leads, sop, split] = await Promise.all([
    getCallQueue(listId, filter, callableNow),
    getDiallerSop(sopRegion),
    // Both halves. The tiles above are list-wide by design and never move, so
    // without these the toggle changes one small badge and reads as broken —
    // and one number alone reads as "135 are being shown" when 194 are.
    countQueueSplit(listId, filter),
  ]);

  // What the Queue tab holds: never rung, rung and not reached, and callbacks
  // whose time has come. One booked for Tuesday is not in it until Tuesday.
  // The badge on the dial card counts the same leads, so the two cannot
  // disagree.
  const inQueue = list.uncalled + list.toRetry + list.callbacksDue;
  // Every lead is in exactly one of these, so they sum to the total.
  const breakdown = [
    { label: "never called", value: list.uncalled },
    { label: "to try again", value: list.toRetry },
    { label: "callback due", value: list.callbacksDue },
    { label: "call later", value: list.callbacksLater },
    { label: "got a demo", value: list.demoBooked + list.trials + list.won },
    { label: "ruled out", value: list.ruledOut },
  ].filter((part) => part.value > 0);

  // Today's calls, partitioned the same way the leads are. Every call today is
  // exactly one of these.
  const today = [
    { label: "spoke to someone", value: list.conversationsToday },
    { label: "no answer", value: list.noAnswerToday },
    { label: "bad number", value: list.badNumbersToday },
  ].filter((part) => part.value > 0);

  return (
    <PageShell title={list.name}>
      <div className="border-b bg-card">
        <div className="mx-auto w-full max-w-2xl px-4 pb-3 pt-3 sm:px-6">
          <Link
            href="/calls"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All call lists
          </Link>

          {/* Two different questions, kept apart. The tiles are what is left
              and what came of it; the line under them partitions the list so
              the numbers can be checked against each other. They used to sit
              side by side with no relationship — "10 called today" next to
              "16 never called" over a queue of 27 looked like broken sums. */}
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Left to call", value: inQueue },
              { label: "Called today", value: list.calledToday },
              {
                label: "Got a demo",
                value: list.demoBooked + list.trials + list.won,
              },
              { label: "Callbacks due", value: list.callbacksDue },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg bg-muted/50 px-2 py-2">
                <p className="text-lg font-extrabold tabular-nums tracking-[-0.02em]">
                  {tile.value}
                </p>
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {tile.label}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[12px] text-muted-foreground">
            {list.total} leads ={" "}
            {breakdown.map((part, i) => (
              <span key={part.label}>
                {i > 0 && " + "}
                <span className="font-semibold tabular-nums">{part.value}</span>{" "}
                {part.label}
              </span>
            ))}
          </p>
          {list.calledToday > 0 && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {list.calledToday} today ={" "}
              {today.map((part, i) => (
                <span key={part.label}>
                  {i > 0 && " + "}
                  <span className="font-semibold tabular-nums">
                    {part.value}
                  </span>{" "}
                  {part.label}
                </span>
              ))}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={`/calls/${listId}?view=${f.key}${callableNow ? "" : "&open=0"}`}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                    f.key === filter
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            {/* The reason this exists: a caller starting at 10pm Singapore can
                ring the US east coast, where it is 10am, but must not be
                handed Honolulu at half past three in the morning. Carries the
                current tab through, or toggling it would quietly reset the
                view. */}
            <Link
              href={`/calls/${listId}?view=${filter}${callableNow ? "&open=0" : ""}`}
              aria-label={
                callableNow
                  ? "Show every lead, whatever time it is there"
                  : "Show only leads it is business hours for"
              }
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                callableNow
                  ? "border-success/40 bg-success/10 text-success hover:bg-success/15"
                  : "hover:bg-muted",
              )}
            >
              <Clock className="size-4" strokeWidth={1.9} />
              {/* Always the same word, lit when it is on — a filter chip says
                  what it filters to. Labelling it "Any time" when off named
                  the current state instead, and was read as the filter being
                  already applied. */}
              <span className="hidden sm:inline">Open now</span>
            </Link>
            {/* Straight to this niche's tab on the Spreadsheet screen, rather
                than to the whole workbook with the right tab to be found.
                Label drops below `sm` so it cannot push the "All" filter off
                the edge of a phone. */}
            <Link
              href={`/call-sheet?list=${listId}`}
              aria-label="Open this list in the spreadsheet"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              <Table2 className="size-4" strokeWidth={1.9} />
              <span className="hidden sm:inline">Spreadsheet</span>
            </Link>
          </div>

          {/* What the toggle actually did. The tiles above count the whole
              niche and do not move, so without this the button is the only
              thing on the screen that changes — and on a list where every lead
              is already callable, nothing changes at all and it reads as
              broken. */}
          {/* Both numbers, always. One alone ("135 can be rung right now")
              sitting above a queue of 194 was read as 135 being shown. */}
          {/* Nothing here when the filter is on and holding everything back:
              "Showing the 0 leads it's business hours for" is a sentence that
              reads as a fault, and the empty state below says the same thing
              properly and offers the way past it. */}
          {split.callableNow < split.total &&
            !(callableNow && split.callableNow === 0) && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {callableNow ? (
                <>
                  Showing the{" "}
                  <span className="font-bold text-foreground">
                    {split.callableNow}
                  </span>{" "}
                  {split.callableNow === 1 ? "lead" : "leads"}{" "}
                  it&rsquo;s business hours for.{" "}
                  {split.total - split.callableNow} more{" "}
                  {split.total - split.callableNow === 1 ? "is" : "are"} asleep
                  where they are.
                </>
              ) : (
                <>
                  Showing all{" "}
                  <span className="font-bold text-foreground">
                    {split.total}
                  </span>
                  .{" "}
                  <span className="font-bold text-foreground">
                    {split.callableNow}
                  </span>{" "}
                  {split.callableNow === 1 ? "is" : "are"} open right now —
                  tap <span className="font-semibold">Open now</span> to work
                  just those.
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {list.total === 0 && list.duplicates > 0 && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-5 sm:px-6">
          <p className="rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
            All {list.duplicates} numbers in this list are already on another
            call list, so there is nothing to work here. They are kept on the
            list but held out of the queue so nobody gets rung twice.
          </p>
        </div>
      )}
      {/* The Closed view is read-only: those calls are already finished. */}
      <Dialler
            calBookingUrl={process.env.CAL_BOOKING_URL}
            canDialFromBrowser={dialMethod === "browser"}
            // Read on the server so the key never reaches the browser. Unset
            // means no arm button, no socket and no cost — the dialler behaves
            // exactly as it did before this shipped.
            liveHints={
              process.env.LIVE_HINTS === "1" && Boolean(process.env.OPENAI_API_KEY)
            }
            lines={dialMethod === "browser" ? await getSavedLines() : []}
            script={sop.script}
            objections={sop.objections}
        leads={leads}
        truncated={leads.length >= CALL_QUEUE_LIMIT}
        readOnly={filter === "closed"}
        // Callers only, matching who the SOP asks to post: a founder's own
        // booking pays nobody and is not the floor's news, the same reason
        // they are off the Scoreboard and off the confirm list.
        callerName={me?.role === "caller" ? me.name : undefined}
        // Only while the filter is doing the hiding. With it off an empty
        // queue really is an empty queue.
        hiddenByHours={callableNow ? split.total - split.callableNow : 0}
        showAllHref={`/calls/${listId}?view=${filter}&open=0`}
      />
    </PageShell>
  );
}
