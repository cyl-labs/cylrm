import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recharge } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/** Remove a top-up entered by mistake. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  await db.delete(recharge).where(eq(recharge.id, id));
  return Response.json({ ok: true });
}
