import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deal, dealStageChange } from "@/db/schema";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

const STAGES = ["replied", "interested", "demo_booked", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) {
    return Response.json({ error: "Invalid deal id." }, { status: 400 });
  }

  let body: { stage?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const stage = body.stage as Stage;
  if (!STAGES.includes(stage)) {
    return Response.json({ error: "Invalid stage." }, { status: 400 });
  }

  const [existing] = await db.select().from(deal).where(eq(deal.id, dealId));
  if (!existing) {
    return Response.json({ error: "Deal not found." }, { status: 404 });
  }
  if (existing.stage === stage) {
    return Response.json({ ok: true, unchanged: true });
  }

  await db.transaction(async (tx) => {
    await tx.insert(dealStageChange).values({
      dealId,
      fromStage: existing.stage,
      toStage: stage,
    });
    await tx.update(deal).set({ stage }).where(eq(deal.id, dealId));
  });

  return Response.json({ ok: true, fromStage: existing.stage, toStage: stage });
}
