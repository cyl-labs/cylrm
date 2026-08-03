import { CALL_SHEET_LIMIT, getCallLists, getSheetLeads } from "@/lib/calls";
import { isDemoMode } from "@/lib/demo";
import { demoCallListSummaries, demoSheetLeads } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { LeadsGrid } from "@/components/calls/leads-grid";

export const dynamic = "force-dynamic";

/**
 * Every calling lead as one spreadsheet.
 *
 * The dialler answers "who do I ring next" one number at a time; this answers
 * "what is on these lists" — every lead, its category, and a tab per list.
 */
export default async function CallSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const demo = await isDemoMode();
  const [{ list }, [leads, lists]] = await Promise.all([
    searchParams,
    demo
      ? [demoSheetLeads(), demoCallListSummaries()]
      : Promise.all([getSheetLeads(), getCallLists()]),
  ]);

  // A `?list=` naming a list that has since gone opens on everything rather
  // than on a tab that is not there.
  const wanted = Number(list);
  const initialTab = lists.some((l) => l.id === wanted) ? wanted : "all";

  return (
    <PageShell title="Spreadsheet">
      {leads.length === 0 ? (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-sm font-semibold">No calling leads yet.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Import a CSV with a phone column on the Call lists screen.
          </p>
        </div>
      ) : (
        <LeadsGrid
          leads={leads}
          // Lists with nothing in them still get a tab: an empty sheet is a
          // fact about the list, not a reason to hide it.
          lists={lists.map((l) => ({ id: l.id, name: l.name }))}
          initialTab={initialTab}
          truncated={leads.length >= CALL_SHEET_LIMIT}
          demo={demo}
        />
      )}
    </PageShell>
  );
}
