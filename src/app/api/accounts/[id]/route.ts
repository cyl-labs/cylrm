import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sendingAccount } from "@/db/schema";
import { getSession } from "@/lib/session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) {
    return Response.json({ error: "Invalid account id." }, { status: 400 });
  }

  let body: { dailyCap?: unknown; active?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Partial<{ dailyCap: number; active: boolean }> = {};
  if (body.dailyCap !== undefined) {
    const dailyCap = Number(body.dailyCap);
    if (!Number.isInteger(dailyCap) || dailyCap < 0) {
      return Response.json(
        { error: "Daily cap must be a whole number of 0 or more." },
        { status: 400 },
      );
    }
    updates.dailyCap = dailyCap;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return Response.json({ error: "active must be a boolean." }, { status: 400 });
    }
    updates.active = body.active;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const [updated] = await db
    .update(sendingAccount)
    .set(updates)
    .where(eq(sendingAccount.id, accountId))
    .returning({ id: sendingAccount.id });
  if (!updated) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
