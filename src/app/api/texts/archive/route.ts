import { getCurrentUser } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { archiveConversation } from "@/lib/texts";
import { parseConversationKey } from "@/lib/text-key";

/**
 * Archive a conversation on the Texts screen, or bring it back.
 *
 * `{ key, archived }`. For the person asking only — see `archiveConversation`.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
    archived?: unknown;
  } | null;
  const c = parseConversationKey(typeof body?.key === "string" ? body.key : null);
  if (!c || typeof body?.archived !== "boolean") {
    return Response.json({ error: "Invalid conversation." }, { status: 400 });
  }
  const ok = await archiveConversation(me, c.their, c.ours, body.archived);
  if (!ok) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
