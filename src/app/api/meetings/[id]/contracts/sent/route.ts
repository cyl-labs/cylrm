import { sql } from "drizzle-orm";
import { db } from "@/db";
import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";

/**
 * Mark a contract as sent: its client link was just copied from the row.
 *
 * Copying the link is the only way a contract leaves the CRM (DocuSeal's
 * mailer cannot send from this droplet), so the first copy is when it was
 * sent. Only the first counts: `coalesce` keeps it, so copying again to
 * re-send does not move the day it was sent on (2026-09-25, for the contract
 * numbers on Stats).
 *
 * The same people who can draft one: founders, and the closer the meeting was
 * handed to.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin" && me.role !== "closer") {
    return Response.json({ error: "Contracts are for founders and closers." }, { status: 403 });
  }
  const id = Number((await params).id);
  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = body?.kind === "trial" || body?.kind === "paid" ? body.kind : null;
  if (!Number.isInteger(id) || !kind) {
    return Response.json({ error: "Invalid contract." }, { status: 400 });
  }
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting || (me.role === "closer" && meeting.closerUserId !== me.id)) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  await db.execute(sql`
    update call_contract set sent_at = coalesce(sent_at, now())
    where meeting_id = ${id} and kind = ${kind}
  `);
  return Response.json({ ok: true });
}
