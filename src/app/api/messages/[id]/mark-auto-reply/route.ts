import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deal, dealStageChange, enrollment, message } from "@/db/schema";
import { OOO_PAUSE_DAYS } from "@/lib/poller";
import { getSession } from "@/lib/session";

/**
 * Manual reclassification (blueprint): a message the poller filed as a
 * human reply was actually an auto-reply. Flips the message kind, removes
 * the auto-created deal (only while still at stage "replied"), returns the
 * enrollment to ooo_paused, and pushes next_send_at out 7 days.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId)) {
    return Response.json({ error: "Invalid message id." }, { status: 400 });
  }

  const [msg] = await db
    .select({
      id: message.id,
      kind: message.kind,
      direction: message.direction,
      enrollmentId: message.enrollmentId,
    })
    .from(message)
    .where(eq(message.id, messageId));
  if (!msg) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }
  if (msg.direction !== "in" || msg.kind !== "reply" || !msg.enrollmentId) {
    return Response.json(
      { error: "Only incoming messages classified as replies can be reclassified." },
      { status: 400 },
    );
  }

  const [enr] = await db
    .select()
    .from(enrollment)
    .where(eq(enrollment.id, msg.enrollmentId));
  if (!enr) {
    return Response.json({ error: "Enrollment not found." }, { status: 404 });
  }

  const [existingDeal] = await db
    .select({ id: deal.id, stage: deal.stage })
    .from(deal)
    .where(
      and(eq(deal.contactId, enr.contactId), eq(deal.campaignId, enr.campaignId)),
    )
    .limit(1);
  if (existingDeal && existingDeal.stage !== "replied") {
    return Response.json(
      {
        error: `The deal has already progressed to "${existingDeal.stage}" — reclassifying now would delete pipeline history. Move the deal back first if this is intended.`,
      },
      { status: 409 },
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(message)
      .set({ kind: "auto_reply" })
      .where(eq(message.id, msg.id));
    if (existingDeal) {
      await tx
        .delete(dealStageChange)
        .where(inArray(dealStageChange.dealId, [existingDeal.id]));
      await tx.delete(deal).where(eq(deal.id, existingDeal.id));
    }
    await tx
      .update(enrollment)
      .set({
        status: "ooo_paused",
        nextSendAt: new Date(Date.now() + OOO_PAUSE_DAYS * 24 * 60 * 60 * 1000),
      })
      .where(eq(enrollment.id, enr.id));
  });

  return Response.json({
    ok: true,
    dealDeleted: !!existingDeal,
    enrollmentId: enr.id,
  });
}
