import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { message } from "@/db/schema";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

/** Mark an inbound message as read. Idempotent — reopening keeps the first
 *  timestamp rather than resetting it. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId)) {
    return Response.json({ error: "Invalid id." }, { status: 400 });
  }
  await db
    .update(message)
    .set({ readAt: new Date() })
    .where(and(eq(message.id, messageId), eq(message.direction, "in")));
  return Response.json({ ok: true });
}
