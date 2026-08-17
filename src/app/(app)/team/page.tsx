import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { listTeam } from "@/lib/users";
import { TeamManager } from "@/components/team/team-manager";

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

  return (
    <PageShell title="Team">
      <div className="px-4 py-4 sm:px-6">
        <TeamManager
          team={team}
          meId={me?.id ?? null}
          canManage={me?.role === "admin"}
        />
      </div>
    </PageShell>
  );
}
