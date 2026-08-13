import { eq, max } from "drizzle-orm";
import { db } from "@/db";
import { campaign, sequenceStep } from "@/db/schema";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) {
    return Response.json({ error: "Invalid campaign id." }, { status: 400 });
  }
  const [found] = await db
    .select({ id: campaign.id })
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  if (!found) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  const [{ maxStep }] = await db
    .select({ maxStep: max(sequenceStep.stepNumber) })
    .from(sequenceStep)
    .where(eq(sequenceStep.campaignId, campaignId));

  const [created] = await db
    .insert(sequenceStep)
    .values({
      campaignId,
      stepNumber: (maxStep ?? 0) + 1,
      waitDaysAfterPrevious: 3,
    })
    .returning();

  return Response.json({ step: created });
}
