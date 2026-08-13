import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser, callList } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/**
 * Hand a niche to somebody, or take it back.
 *
 * Admin only, because who works what is how the floor is run rather than
 * something a caller settles for themselves. It changes nothing about who
 * *can* call: the queue, the board and the spreadsheet all ignore the owner,
 * and only the call lists screen reads it.
 *
 * `assignedUserId: null` unassigns.
 */
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
  } | null;
  if (!body || !("assignedUserId" in body)) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

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

  const [row] = await db
    .update(callList)
    .set({ assignedUserId })
    .where(eq(callList.id, listId))
    .returning({ id: callList.id, assignedUserId: callList.assignedUserId });

  if (!row) {
    return Response.json({ error: "List not found." }, { status: 404 });
  }
  return Response.json(row);
}
