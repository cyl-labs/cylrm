import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { callLead, callList } from "@/db/schema";
import { getRecordingsForNumber } from "@/lib/recordings";
import { callScope, getCurrentUser } from "@/lib/session";

/**
 * Every recording of a call with this lead's number, for the Spreadsheet.
 *
 * Fetched when somebody opens the list rather than shipped with the sheet,
 * which already carries thousands of rows. The lead is scoped the way the
 * sheet is — a caller sees only leads on their own niches — and each recording
 * then passes the same test its play button does, so nothing is offered that
 * would refuse to play.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const leadId = Number((await params).id);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }

  const owner = callScope(me);
  const [lead] = await db
    .select({ phoneKey: callLead.phoneKey })
    .from(callLead)
    .innerJoin(callList, eq(callList.id, callLead.callListId))
    .where(
      owner === undefined
        ? eq(callLead.id, leadId)
        : and(eq(callLead.id, leadId), eq(callList.assignedUserId, owner)),
    );
  if (!lead) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  const recordings = await getRecordingsForNumber(`+${lead.phoneKey}`, me);
  return Response.json({ recordings });
}
