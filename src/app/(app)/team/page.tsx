import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { listTeam } from "@/lib/users";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listAccountNumbers } from "@/lib/telnyx";
import { TeamManager } from "@/components/team/team-manager";
import { TelnyxNumbers } from "@/components/team/telnyx-numbers";

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
  const reservedRows =
    me?.role === "admin"
      ? ((await db.execute(
          sql`select phone_number from call_number where available = false`,
        )) as { phone_number: string }[])
      : [];
  const numbers =
    me?.role === "admin"
      ? await listAccountNumbers(new Set(reservedRows.map((r) => r.phone_number)))
      : [];

  return (
    <PageShell title="Team">
      <div className="px-4 py-4 sm:px-6">
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
