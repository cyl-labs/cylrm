import { getCurrentUser } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { markConversationRead } from "@/lib/texts";
import { parseConversationKey } from "@/lib/text-key";

/**
 * Mark a conversation read, when it is opened on the Texts screen.
 *
 * A POST from the browser rather than a side effect of rendering the page:
 * Next prefetches links, and a conversation marked read because its link was
 * on screen would clear a dot nobody had looked behind.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const c = parseConversationKey(typeof body?.key === "string" ? body.key : null);
  if (!c) {
    return Response.json({ error: "Invalid conversation." }, { status: 400 });
  }
  const marked = await markConversationRead(me, c.their, c.ours);
  return Response.json({ ok: true, marked });
}
