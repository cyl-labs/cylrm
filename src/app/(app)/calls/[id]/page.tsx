import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Table2 } from "lucide-react";
import {
  CALL_QUEUE_LIMIT,
  getCallList,
  getCallQueue,
  type CallQueueFilter,
} from "@/lib/calls";
import { isDemoMode } from "@/lib/demo";
import { demoCallListDetail, demoCallQueue } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { Dialler } from "@/components/calls/dialler";
import { cn } from "@/lib/utils";

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
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) notFound();

  const { view } = await searchParams;
  const filter: CallQueueFilter = isFilter(view) ? view : "queue";

  const demo = await isDemoMode();
  const list = demo ? demoCallListDetail(listId) : await getCallList(listId);
  if (!list) notFound();

  const leads = demo
    ? demoCallQueue(listId, filter)
    : await getCallQueue(listId, filter);

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
                  href={`/calls/${listId}?view=${f.key}`}
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
      {/* The demo keeps its outcome buttons and advances the queue locally —
          it just never writes. Only the Closed view is genuinely read-only,
          because those calls are already finished. */}
      <Dialler
        leads={leads}
        truncated={leads.length >= CALL_QUEUE_LIMIT}
        readOnly={filter === "closed"}
        demo={demo}
      />
    </PageShell>
  );
}
