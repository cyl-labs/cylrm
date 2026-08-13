import { db } from "@/db";
import { campaign, sequenceStep } from "@/db/schema";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") {
    return Response.json({ error: "Campaign name is required." }, { status: 400 });
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaign)
      .values({ name })
      .returning({ id: campaign.id });
    await tx.insert(sequenceStep).values({
      campaignId: row.id,
      stepNumber: 1,
      waitDaysAfterPrevious: 0,
    });
    return row;
  });

  return Response.json({ campaign: created });
}
