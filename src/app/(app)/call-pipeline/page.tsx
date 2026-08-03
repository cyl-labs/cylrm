import { BOARD_COLUMN_LIMIT, getCallBoard } from "@/lib/calls";
import { isDemoMode } from "@/lib/demo";
import { demoCallBoard } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { CallBoard } from "@/components/calls/call-board";

export const dynamic = "force-dynamic";

/**
 * The calling pipeline.
 *
 * Its own board, not the email one: calling leads have no deal rows and share
 * no tables with campaigns, and putting a phone demo on the email pipeline
 * would confound every campaign comparison on the Stats screen.
 */
export default async function CallPipelinePage() {
  const demo = await isDemoMode();
  const { cards, closed } = demo ? demoCallBoard() : await getCallBoard();

  return (
    <PageShell title="Pipeline">
      <div className="flex h-full flex-col gap-3 px-4 py-4 sm:px-6">
        {cards.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <p className="text-sm font-semibold">Nothing live to work.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {closed > 0
                ? `Every lead has been closed out (${closed.toLocaleString()} of them). Import a list to keep going.`
                : "Import a CSV with a phone column on the Call lists screen."}
            </p>
          </div>
        ) : (
          <>
            <p className="shrink-0 text-[13px] text-muted-foreground">
              Drag a card, or use its menu, to log a call. Moving a card
              <em> is </em>
              logging the call — there is no status here that a phone call did
              not put there.
              {closed > 0 &&
                ` ${closed.toLocaleString()} finished-with leads are not shown.`}
            </p>
            <CallBoard
              cards={cards}
              closed={closed}
              columnLimit={BOARD_COLUMN_LIMIT}
              demo={demo}
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
