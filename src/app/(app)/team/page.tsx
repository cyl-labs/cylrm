import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { listTeam } from "@/lib/users";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listAccountNumbers } from "@/lib/telnyx";
import { TeamManager } from "@/components/team/team-manager";
import { TelnyxNumbers } from "@/components/team/telnyx-numbers";
import { LiveCallers } from "@/components/team/live-callers";

export const dynamic = "force-dynamic";

/**
 * The people who can sign in.
 *
 * Admin-only, both the screen and the writes. It carries roles, markets and
 * who is switched off, which is staffing rather than performance. Callers see
 * each other's numbers on the Scoreboard instead, which is the part that is
 * theirs to care about.
 *
 * The API enforces it too rather than trusting the screen to hide the buttons.
 */
export default async function TeamPage() {
  const me = await getCurrentUser();
  const team = await listTeam();

  // Fetched here rather than by each component, so reserving a number updates
  // the panel and the assign dropdowns together on one router.refresh().
  // Every row, not just the reserved ones: a number can carry a label while
  // staying in the pool, so filtering on `available = false` here would drop
  // exactly those labels. "Absent means available" still holds — the reserved
  // set is built from the flag below, never from a row existing.
  const numberRows =
    me?.role === "admin"
      ? ((await db.execute(
          sql`select phone_number, available, label from call_number`,
        )) as { phone_number: string; available: boolean; label: string | null }[])
      : [];
  const numbers =
    me?.role === "admin"
      ? await listAccountNumbers(
          new Set(
            numberRows.filter((r) => !r.available).map((r) => r.phone_number),
          ),
          new Map(
            numberRows
              .filter((r) => r.label)
              .map((r) => [r.phone_number, r.label as string]),
          ),
        )
      : [];

  return (
    <PageShell title="Team">
      <div className="px-4 py-4 sm:px-6">
        {/* Above the numbers panel because it is the thing you open this
            screen to glance at before shipping, and it is one line when the
            answer is no. */}
        {me?.role === "admin" && (
          <LiveCallers className="mb-5 rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]" />
        )}
        {me?.role === "admin" && (
          <TelnyxNumbers
            numbers={numbers}
            team={team}
            className="mb-5 rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]"
          />
        )}
        <TeamManager
          numbers={numbers}
          team={team}
          meId={me?.id ?? null}
          canManage={me?.role === "admin"}
        />
      </div>
    </PageShell>
  );
}
