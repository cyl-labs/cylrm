import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

async function guard() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }
  return null;
}

/** Stop or restart a subscription. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guard();
  if (denied) return denied;
  const id = Number((await params).id);
  const body = (await request.json().catch(() => null)) as {
    active?: unknown;
  } | null;
  if (!Number.isInteger(id) || typeof body?.active !== "boolean") {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  await db
    .update(subscription)
    .set({ active: body.active })
    .where(eq(subscription.id, id));
  return Response.json({ ok: true });
}

/** Remove one entered by mistake. Stopping is the normal way to end one. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guard();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  await db.delete(subscription).where(eq(subscription.id, id));
  return Response.json({ ok: true });
}
