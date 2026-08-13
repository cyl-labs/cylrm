import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { getCallLists } from "@/lib/calls";
import { getCurrentUser } from "@/lib/session";
import { listTeam } from "@/lib/users";
import { PageShell } from "@/components/page-shell";
import { CallImportDialog } from "@/components/calls/call-import-dialog";
import { ListAssignment } from "@/components/calls/list-assignment";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const [{ mine: mineParam }, all, me, team] = await Promise.all([
    searchParams,
    getCallLists(),
    getCurrentUser(),
    listTeam(),
  ]);

  const myLists = all.filter((l) => l.assignedUserId === me?.id);
  // Default to your own niches only when you have some — a new caller with
  // nothing assigned would otherwise land on an empty screen and conclude
  // there is no work.
  const mine = mineParam === undefined ? myLists.length > 0 : mineParam === "1";
  const lists = mine && myLists.length > 0 ? myLists : all;
  const people = team.map((t) => ({ id: t.id, name: t.name, active: t.active }));

  return (
    <PageShell
      title="Call lists"
      actions={
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {myLists.length > 0 && (
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
          <CallImportDialog
            callLists={all.map((l) => ({ id: l.id, name: l.name }))}
          />
        </div>
      }
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
                <li key={l.id} className="relative">
                  {/* Over the card, not inside it — the card is one big link
                      and a menu nested in an anchor navigates as it opens. */}
                  <div className="absolute right-3 top-3 z-10">
                    <ListAssignment
                      listId={l.id}
                      assignedName={l.assignedName}
                      assignedUserId={l.assignedUserId}
                      people={people}
                      canManage={me?.role === "admin"}
                    />
                  </div>
                  <Link
                    href={`/calls/${l.id}`}
                    className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
                  >
                    {/* Room for the owner control pinned to this corner —
                        without it a long niche name runs underneath it. */}
                    <div className="flex items-start gap-2 pr-24">
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
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
