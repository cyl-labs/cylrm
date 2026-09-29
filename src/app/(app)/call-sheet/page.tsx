import { CALL_SHEET_LIMIT, getCallLists, getSheetLeads } from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";
import { PageShell } from "@/components/page-shell";
import { LeadsGrid } from "@/components/calls/leads-grid";

export const dynamic = "force-dynamic";

/**
 * The calling leads as a spreadsheet, one list at a time.
 *
 * The dialler answers "who do I ring next" one number at a time; this answers
 * "what is on these lists" — every lead on a list, its category, and a tab per
 * list. Finding a business without knowing its list is the search box, which
 * asks the server across all of them.
 */
export default async function CallSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const me = await getCurrentUser();
  // One clock for the sheet, the one this person reads Stats and Meetings in.
  const zone = await readerZone(me?.id);
  const [{ list }, lists] = await Promise.all([
    searchParams,
    getCallLists(callScope(me), zone.tz),
  ]);

  // One list is loaded at a time (2026-09-29). The sheet used to load every
  // lead and cut off at 5,000 of the 9,900 there are, which hid the leads
  // nobody had rung. It opens on the list named by `?list=`, else the first
  // one somebody has called, and a search box looks across all of them. A
  // `?list=` naming a list that has since gone falls back the same way.
  const wanted = Number(list);
  const opening =
    lists.find((l) => l.id === wanted) ??
    lists.find((l) => l.total - l.uncalled > 0) ??
    lists[0];
  const leads = opening
    ? await getSheetLeads(callScope(me), { listId: opening.id })
    : [];

  return (
    <PageShell title="Spreadsheet">
      {!opening ? (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-sm font-semibold">No calling leads yet.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Import a CSV with a phone column on the Call lists screen.
          </p>
        </div>
      ) : (
        <LeadsGrid
          showDealStages={me?.role === "admin"}
          leads={leads}
          tz={zone.tz}
          zoneLabel={zone.label}
          // Every niche goes down, with a flag for whether anyone has called
          // it: the called ones get tabs, the rest fold under "Not called
          // yet". Nothing is unreachable, and the strip is readable.
          lists={lists.map((l) => ({
            id: l.id,
            name: l.name,
            called: l.total - l.uncalled > 0,
            count: l.total,
          }))}
          initialTab={opening.id}
          truncated={leads.length >= CALL_SHEET_LIMIT}
          meName={me?.name ?? null}
        />
      )}
    </PageShell>
  );
}
