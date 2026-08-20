import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appUser, call, callLead, callList } from "@/db/schema";
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
    name?: unknown;
  } | null;
  if (
    !body ||
    (!("assignedUserId" in body) && !("region" in body) && !("name" in body))
  ) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const values: {
    assignedUserId?: number | null;
    region?: "sg" | "us" | "gb" | null;
    name?: string;
  } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      return Response.json({ error: "A list needs a name." }, { status: 400 });
    }
    // Not checked for uniqueness: two niches genuinely can share a name, and
    // the id is what everything joins on. A duplicate is a mild annoyance, a
    // refused rename in the middle of tidying up is worse.
    values.name = name;
  }

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
      name: callList.name,
      assignedUserId: callList.assignedUserId,
      region: callList.region,
    });

  if (!row) {
    return Response.json({ error: "List not found." }, { status: 404 });
  }
  return Response.json(row);
}

/**
 * Delete a list, its leads, and the calls made against them.
 *
 * Admin only, and genuinely destructive: a list imported from the wrong file
 * is the ordinary case, but the same button would take real call history with
 * it. So the count of calls comes back in the response and the confirmation
 * says it out loud rather than the API quietly refusing — a founder who means
 * it should not have to ask someone to run SQL.
 *
 * Ordered leaf-first because `call` references `call_lead` and `call_lead`
 * references `call_list`; a transaction so a failure part-way leaves the list
 * whole rather than half-emptied.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can delete a list." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return Response.json({ error: "Invalid list." }, { status: 400 });
  }

  const [found] = await db
    .select({ id: callList.id, name: callList.name })
    .from(callList)
    .where(eq(callList.id, listId));
  if (!found) {
    return Response.json({ error: "List not found." }, { status: 404 });
  }

  const result = await db.transaction(async (tx) => {
    const leadIds = (
      await tx
        .select({ id: callLead.id })
        .from(callLead)
        .where(eq(callLead.callListId, listId))
    ).map((r) => r.id);

    let calls = 0;
    if (leadIds.length > 0) {
      calls = (
        await tx
          .delete(call)
          .where(inArray(call.callLeadId, leadIds))
          .returning({ id: call.id })
      ).length;
      // Leads on *other* lists may point here as duplicates; clearing the
      // pointer keeps them, and their numbers come back into the queue now
      // that the original is gone.
      await tx
        .update(callLead)
        .set({ duplicateOfLeadId: null })
        .where(inArray(callLead.duplicateOfLeadId, leadIds));
      await tx.delete(callLead).where(eq(callLead.callListId, listId));
    }
    await tx.delete(callList).where(eq(callList.id, listId));
    return { leads: leadIds.length, calls };
  });

  return Response.json({ name: found.name, ...result });
}
