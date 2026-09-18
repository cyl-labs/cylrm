import { getCallbacks, getCallLists } from "@/lib/calls";
import { PageShell } from "@/components/page-shell";
import { CallbacksList } from "@/components/calls/callbacks-list";
import { CallFilters } from "@/components/calls/call-filters";
import { callScope, getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Everyone who asked to be rung back, soonest first.
 *
 * Its own screen rather than a filter on a list, because a callback is a
 * promise made at a time and the question it answers — "who am I late for" —
 * spans every niche at once. The dialler's Callbacks tab still exists for
 * working one list; this is the diary.
 */
export default async function CallbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const { list } = await searchParams;
  const me = await getCurrentUser();
  const lists = await getCallLists(callScope(me));

  const wanted = Number(list);
  const listId = lists.some((l) => l.id === wanted) ? wanted : undefined;

  const leads = await getCallbacks(listId, callScope(me));
  // `due` and `waiting` are decided by the database's clock, not this render's.
  const due = leads.filter((l) => l.due).length;
  const waiting = leads.filter((l) => l.waiting).length;
  const later = leads.length - due - waiting;
  const rest = [
    waiting > 0 && `${waiting} waiting for them to open`,
    later > 0 && `${later} later`,
  ].filter(Boolean);

  return (
    <PageShell
      title="Callbacks"
      actions={
        <CallFilters
          lists={lists.map((l) => ({ id: l.id, name: l.name }))}
          listId={listId ?? "all"}
        />
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
        {leads.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            {due > 0 ? (
              <>
                <span className="font-bold text-destructive">
                  {due} due now
                </span>
                {rest.length > 0 && `, ${rest.join(", ")}`}
              </>
            ) : waiting > 0 ? (
              `None due right now: ${rest.join(", ")}`
            ) : (
              `${leads.length} scheduled, none due yet`
            )}
            . Times are where the prospect is, and each row says which clock.
          </p>
        )}
        <CallbacksList
          readerTz={(await readerZone(me?.id)).tz}
          leads={leads}
          showWho={me?.role === "admin"}
          canRingClosed={me?.role === "admin"}
        />
      </div>
    </PageShell>
  );
}
