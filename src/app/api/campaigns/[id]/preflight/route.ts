import { getCampaignPreflight } from "@/lib/campaign-preflight";
import { getSession } from "@/lib/session";

/** Everything the activation dialog shows before a campaign starts sending. */
export async function GET(
  _request: Request,
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

  const preflight = await getCampaignPreflight(campaignId);
  if (!preflight) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  return Response.json(preflight);
}
