import { getCurrentUser } from "@/lib/session";
import {
  getSameBusinessGroups,
  holdOutSameBusiness,
} from "@/lib/same-business";

/**
 * The same business on several leads already in the CRM.
 *
 * GET lists the groups; POST holds the ticked leads out of the queue. Admin
 * only, the same as importing: which leads exist is how the floor is run.
 * `/api` is outside the middleware, so the role is checked here.
 */
async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can merge leads." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  const refused = await requireAdmin();
  if (refused) return refused;
  return Response.json({ groups: await getSameBusinessGroups() });
}

export async function POST(request: Request) {
  const refused = await requireAdmin();
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as {
    leadIds?: unknown;
  } | null;
  const ids = Array.isArray(body?.leadIds) ? body.leadIds : null;
  if (!ids || ids.length === 0 || !ids.every((v) => Number.isInteger(v))) {
    return Response.json({ error: "Tick at least one lead." }, { status: 400 });
  }
  const held = await holdOutSameBusiness(ids as number[]);
  return Response.json({ held });
}
