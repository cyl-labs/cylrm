import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
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

          <nav className="mt-3 flex gap-1 overflow-x-auto">
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
      <Dialler leads={leads} readOnly={filter === "closed"} demo={demo} />
    </PageShell>
  );
}
