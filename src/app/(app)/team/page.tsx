import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo";
import { demoTeam } from "@/lib/demo-data";
import { listTeam } from "@/lib/users";
import { TeamManager } from "@/components/team/team-manager";

export const dynamic = "force-dynamic";

/**
 * The people who can sign in.
 *
 * Everyone can see the list — knowing who is on the floor is not privileged,
 * and the stats name them anyway. Only an admin can change it, and the API
 * enforces that rather than trusting the screen to hide the buttons.
 */
export default async function TeamPage() {
  const demo = await isDemoMode();
  const me = await getCurrentUser();
  const team = demo ? demoTeam() : await listTeam();

  return (
    <PageShell title="Team">
      <div className="px-4 py-4 sm:px-6">
        <TeamManager
          team={team}
          meId={me?.id ?? null}
          canManage={me?.role === "admin"}
          demo={demo}
        />
      </div>
    </PageShell>
  );
}
