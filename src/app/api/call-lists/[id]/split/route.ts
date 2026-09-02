import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Divide a list already in the CRM between several callers.
 *
 * The importer has always been able to split a file on the way in. This is the
 * case it could not reach: a niche imported whole that now has to be shared,
 * because somebody joined, somebody left, or one list turned out to be a
 * fortnight of work for one person.
 *
 * The rules are the importer's, deliberately, because they were arrived at for
 * reasons that have not changed:
 *
 * - **Dealt round-robin, never cut into blocks.** A scrape arrives sorted — by
 *   city, by rating, by whatever the directory ordered on — so contiguous
 *   slices hand one caller every Alaska lead and another every Californian one.
 *   Dealing gives each part the same mix and, to within one lead, the same size.
 * - **Duplicates are not dealt.** They are already held out of every queue and
 *   count, so including them would make one caller's share look larger than the
 *   work in it. They stay on the original.
 * - **One transaction.** A split that half-succeeds leaves a niche divided
 *   between callers with a chunk of it missing, which is worse than not having
 *   split at all.
 *
 * The original list is kept and becomes the first part rather than being
 * emptied and deleted: its id is what every logged call reaches through, and a
 * list somebody has been working should not change identity because it was
 * shared out.
 */

/** As many ways as the importer allows, and for the same reason: well above
 *  the size of the floor, low enough that a typo cannot make forty lists. */
const MAX_PARTS = 10;

type Part = { name: string; assignedUserId: number | null };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Enforced here rather than by hiding the menu item: a caller has no business
  // redrawing who owns what, and hiding a control is a courtesy a fetch walks
  // straight past.
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can split a list." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return Response.json({ error: "Invalid call list." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    parts?: unknown;
  } | null;
  const raw = Array.isArray(body?.parts) ? body.parts : null;
  if (!raw || raw.length < 2 || raw.length > MAX_PARTS) {
    return Response.json(
      { error: `Choose between 2 and ${MAX_PARTS} lists.` },
      { status: 400 },
    );
  }

  const parts: Part[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) {
      return Response.json({ error: "Invalid part." }, { status: 400 });
    }
    const { name, assignedUserId } = p as { name?: unknown; assignedUserId?: unknown };
    const trimmed = typeof name === "string" ? name.trim().slice(0, 120) : "";
    if (!trimmed) {
      return Response.json({ error: "Every list needs a name." }, { status: 400 });
    }
    if (
      assignedUserId !== null &&
      assignedUserId !== undefined &&
      !Number.isInteger(assignedUserId)
    ) {
      return Response.json({ error: "Invalid owner." }, { status: 400 });
    }
    parts.push({
      name: trimmed,
      assignedUserId: Number.isInteger(assignedUserId) ? (assignedUserId as number) : null,
    });
  }

  const result = await db.transaction(async (tx) => {
    const [list] = (await tx.execute(sql`
      select id, name, region from call_list where id = ${listId}
    `)) as { id: number; name: string; region: string | null }[];
    if (!list) return { error: "That list no longer exists." as const };

    // Only the leads somebody can actually ring. A duplicate is already out of
    // every queue, so dealing it would pad one share with work that is not
    // there. Ordered by id so the deal is deterministic and a retry lands the
    // same way.
    const workable = (await tx.execute(sql`
      select id from call_lead
      where call_list_id = ${listId} and duplicate_of_lead_id is null
      order by id
    `)) as { id: number }[];

    if (workable.length < parts.length) {
      return {
        error: `Only ${workable.length} leads can be rung — not enough for ${parts.length} lists.` as const,
      };
    }

    // The first part keeps the original list; the rest are created.
    const ids: number[] = [list.id];
    for (const part of parts.slice(1)) {
      const [made] = (await tx.execute(sql`
        insert into call_list (name, region, assigned_user_id)
        values (${part.name}, ${list.region}, ${part.assignedUserId})
        returning id
      `)) as { id: number }[];
      ids.push(made.id);
    }
    await tx.execute(sql`
      update call_list
      set name = ${parts[0].name}, assigned_user_id = ${parts[0].assignedUserId}
      where id = ${list.id}
    `);

    // Deal. Part 0 is already where it needs to be, so only the others move.
    const moves = new Map<number, number[]>();
    workable.forEach((lead, i) => {
      const target = i % parts.length;
      if (target === 0) return;
      const to = ids[target];
      moves.set(to, [...(moves.get(to) ?? []), lead.id]);
    });
    for (const [to, leadIds] of moves) {
      await tx.execute(sql`
        update call_lead set call_list_id = ${to}
        where id = any(${sql.raw(`array[${leadIds.join(",")}]::int[]`)})
      `);
    }

    return {
      parts: ids.map((listId, i) => ({
        id: listId,
        name: parts[i].name,
        leads: workable.filter((_, n) => n % parts.length === i).length,
      })),
    };
  });

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result);
}
