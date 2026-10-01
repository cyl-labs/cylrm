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
    .select({ phoneKey: callLead.phoneKey, directPhoneKey: callLead.directPhoneKey })
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

  // The main number and the direct line (a second number somebody gave us for
  // the same business), newest first. Without the second, a 30 minute call on
  // the direct line was attached to nothing on the lead.
  const numbers = [lead.phoneKey, lead.directPhoneKey].filter(
    (k): k is string => Boolean(k),
  );
  const recordings = (
    await Promise.all(numbers.map((k) => getRecordingsForNumber(`+${k}`, me)))
  )
    .flat()
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return Response.json({ recordings });
}
