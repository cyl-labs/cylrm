import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser, callList } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/**
 * Hand a niche to somebody, or file it under a market.
 *
 * Admin only, because who works what is how the floor is run rather than
 * something a caller settles for themselves. Neither field changes who *can*
 * call: the queue, the board and the spreadsheet all ignore both, and only the
 * call lists screen reads them.
 *
 * Both fields are optional and applied independently, so a caller of this
 * route can change one without knowing the other's current value. Sending
 * neither is an error rather than a silent no-op — it means the caller thinks
 * it is changing something.
 *
 * `assignedUserId: null` unassigns; `region: null` unfiles.
 */
const REGIONS = ["sg", "us", "gb"] as const;
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can assign a list." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return Response.json({ error: "Invalid list." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    assignedUserId?: unknown;
    region?: unknown;
  } | null;
  if (!body || (!("assignedUserId" in body) && !("region" in body))) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const values: { assignedUserId?: number | null; region?: "sg" | "us" | "gb" | null } =
    {};

  if ("assignedUserId" in body) {
    const raw = body.assignedUserId;
    let assignedUserId: number | null = null;
    if (raw !== null) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) {
        return Response.json({ error: "Invalid person." }, { status: 400 });
      }
      // Checked rather than left to the foreign key, which would surface as a
      // constraint error with nothing useful to put on screen. Deactivated
      // people are still assignable: switching someone off for a fortnight
      // should not silently strip their niches.
      const [person] = await db
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.id, parsed));
      if (!person) {
        return Response.json({ error: "Person not found." }, { status: 404 });
      }
      assignedUserId = parsed;
    }
    values.assignedUserId = assignedUserId;
  }

  if ("region" in body) {
    const raw = body.region;
    if (raw === null) {
      values.region = null;
    } else if (
      typeof raw === "string" &&
      (REGIONS as readonly string[]).includes(raw)
    ) {
      values.region = raw as "sg" | "us" | "gb";
    } else {
      // Rejected here rather than left to the check constraint, which would
      // come back as a raw database error with nothing to show the user.
      return Response.json({ error: "Invalid folder." }, { status: 400 });
    }
  }

  const [row] = await db
    .update(callList)
    .set(values)
    .where(eq(callList.id, listId))
    .returning({
      id: callList.id,
      assignedUserId: callList.assignedUserId,
      region: callList.region,
    });

  if (!row) {
    return Response.json({ error: "List not found." }, { status: 404 });
  }
  return Response.json(row);
}
