import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaign,
  deal,
  enrollment,
  message,
  sendIssue,
  sequenceStep,
} from "@/db/schema";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

const STATUSES = ["draft", "active", "paused"] as const;
type Status = (typeof STATUSES)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) {
    return Response.json({ error: "Invalid campaign id." }, { status: 400 });
  }

  let body: { name?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Partial<{ name: string; status: Status }> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      return Response.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return Response.json({ error: "Invalid status." }, { status: 400 });
    }
    updates.status = body.status as Status;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const [updated] = await db
    .update(campaign)
    .set(updates)
    .where(eq(campaign.id, campaignId))
    .returning({ id: campaign.id });
  if (!updated) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}

/**
 * Delete a campaign that never sent anything.
 *
 * Refused once it has sent messages or produced deals: every figure on the
 * Stats screen is computed live from those rows, so removing them would
 * silently rewrite past reply rates and demo counts rather than just tidying
 * the list. Same rule as deleting a sending account — history wins, and the
 * caller is pointed at Pause instead.
 *
 * Queued enrollments are not a reason to refuse. Nothing has gone out yet, so
 * dropping them only frees those contacts to be enrolled elsewhere; the count
 * is returned so the UI can name it in its confirmation.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) {
    return Response.json({ error: "Invalid campaign id." }, { status: 400 });
  }

  const [camp] = await db
    .select({ id: campaign.id, name: campaign.name })
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  if (!camp) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  const [{ count: sentCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(message)
    .innerJoin(enrollment, eq(enrollment.id, message.enrollmentId))
    .where(eq(enrollment.campaignId, campaignId));
  const [{ count: dealCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deal)
    .where(eq(deal.campaignId, campaignId));

  if (sentCount > 0 || dealCount > 0) {
    const parts = [];
    if (sentCount > 0)
      parts.push(`${sentCount} message${sentCount === 1 ? "" : "s"}`);
    if (dealCount > 0)
      parts.push(`${dealCount} deal${dealCount === 1 ? "" : "s"}`);
    return Response.json(
      {
        error: `${camp.name} has ${parts.join(" and ")} counted in your stats — deleting it would change past numbers. Pause it instead.`,
      },
      { status: 409 },
    );
  }

  const [{ count: enrolledCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrollment)
    .where(eq(enrollment.campaignId, campaignId));

  await db.transaction(async (tx) => {
    // send_issue references the campaign, so it has to go first or the
    // foreign key blocks the delete.
    await tx.delete(sendIssue).where(eq(sendIssue.campaignId, campaignId));
    await tx.delete(enrollment).where(eq(enrollment.campaignId, campaignId));
    await tx.delete(sequenceStep).where(eq(sequenceStep.campaignId, campaignId));
    await tx.delete(campaign).where(eq(campaign.id, campaignId));
  });

  return Response.json({ ok: true, name: camp.name, enrolledCount });
}
