import { unsubscribeByContactId } from "@/lib/unsubscribe";
import { getSession } from "@/lib/session";

/**
 * Operator-initiated unsubscribe, from the pipeline thread view. The actual
 * suppression lives in `unsubscribeByContactId`, shared with the public
 * one-click link so both routes behave identically.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contactId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const contactId = Number(body.contactId);
  if (!Number.isInteger(contactId)) {
    return Response.json({ error: "contactId is required." }, { status: 400 });
  }

  const result = await unsubscribeByContactId(contactId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 404 });
  }
  return Response.json({
    ok: true,
    email: result.email,
    alreadyUnsubscribed: result.alreadyUnsubscribed,
  });
}
