import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  CALL_SHEET_LIMIT,
  getCallLeads,
  getCallList,
  getCallQueue,
  type CallQueueFilter,
} from "@/lib/calls";
import { isDemoMode } from "@/lib/demo";
import {
  demoCallListDetail,
  demoCallQueue,
  demoCallSheet,
} from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { CallSheet } from "@/components/calls/call-sheet";
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
  searchParams: Promise<{ view?: string; mode?: string }>;
}) {
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) notFound();

  const { view, mode } = await searchParams;
  const filter: CallQueueFilter = isFilter(view) ? view : "queue";
  // Dial is the default: this screen exists to make calls, and the sheet is
  // for looking the list over.
  const sheet = mode === "sheet";

  const demo = await isDemoMode();
  const list = demo ? demoCallListDetail(listId) : await getCallList(listId);
  if (!list) notFound();

  const leads = sheet
    ? demo
      ? demoCallSheet(listId)
      : await getCallLeads(listId)
    : demo
      ? demoCallQueue(listId, filter)
      : await getCallQueue(listId, filter);

  return (
    <PageShell title={list.name}>
      <div className="border-b bg-card">
        <div
          className={cn(
            "w-full px-4 pb-3 pt-3 sm:px-6",
            !sheet && "mx-auto max-w-2xl",
          )}
        >
          <Link
            href="/calls"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All call lists
          </Link>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Today", value: list.calledToday },
              { label: "Never called", value: list.uncalled },
              // Both outcomes are a lead worth keeping, and a tile reading
              // "Interested: 0" the moment you book a demo would be wrong.
              { label: "Positive", value: list.interested + list.demoBooked },
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

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Dial works one number at a time; Sheet is the whole list at
                once. The queue filters only mean anything in Dial, so they
                disappear in Sheet, which has its own category chips. */}
            <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
              {[
                { key: "dial", label: "Dial", href: `/calls/${listId}?view=${filter}` },
                { key: "sheet", label: "Sheet", href: `/calls/${listId}?mode=sheet` },
              ].map((m) => (
                <Link
                  key={m.key}
                  href={m.href}
                  className={cn(
                    "rounded-md px-3 py-1 text-[13px] font-semibold transition-colors",
                    (m.key === "sheet") === sheet
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </Link>
              ))}
            </div>

            {!sheet && (
              <nav className="flex gap-1 overflow-x-auto">
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
            )}
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

      {sheet ? (
        <CallSheet
          leads={leads}
          listName={list.name}
          truncated={leads.length >= CALL_SHEET_LIMIT}
          demo={demo}
        />
      ) : (
        /* The demo keeps its outcome buttons and advances the queue locally —
           it just never writes. Only the Closed view is genuinely read-only,
           because those calls are already finished. */
        <Dialler leads={leads} readOnly={filter === "closed"} demo={demo} />
      )}
    </PageShell>
  );
}
