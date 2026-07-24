import { eq } from "drizzle-orm";
import { db } from "@/db";
import { campaign } from "@/db/schema";
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
