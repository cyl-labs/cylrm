import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { getCallLists } from "@/lib/calls";
import { isDemoMode } from "@/lib/demo";
import { demoCallListSummaries } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { CallImportDialog } from "@/components/calls/call-import-dialog";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  // Demo Call CRM runs on its own fixtures, not the real lists — the two
  // systems share no tables and a demo that blurred that would misrepresent it.
  const demo = await isDemoMode();
  const lists = demo ? demoCallListSummaries() : await getCallLists();

  return (
    <PageShell
      title="Call lists"
      actions={<CallImportDialog callLists={lists.map((l) => ({ id: l.id, name: l.name }))} />}
    >
      <div className="px-4 py-5 sm:px-6">
        {lists.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <PhoneCall
              className="mx-auto size-6 text-muted-foreground"
              strokeWidth={1.6}
            />
            <p className="mt-3 text-sm font-semibold">No call lists yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Import a CSV with a phone column to start calling.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {lists.map((l) => {
              // The bar tracks the queue emptying, not leads touched once.
              // "35 of 40 worked" over a screen that then asked for 21 more
              // calls was two different questions wearing the same sentence:
              // a lead rung and not reached is still work.
              const leftToCall = l.uncalled + l.toRetry + l.callbacksDue;
              const done = l.total - leftToCall;
              const pct = l.total === 0 ? 0 : Math.round((done / l.total) * 100);
              return (
                <li key={l.id}>
                  <Link
                    href={`/calls/${l.id}`}
                    className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start gap-2">
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
                      {l.callbacksDue > 0 && (
                        <Badge className="ml-auto shrink-0">
                          {l.callbacksDue} callback
                          {l.callbacksDue === 1 ? "" : "s"} due
                        </Badge>
                      )}
                    </div>

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
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
