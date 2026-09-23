import { getCurrentUser } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { linkConversation, searchLeadsToLink } from "@/lib/texts";

/**
 * Attach a conversation to a business — for an owner texting from their own
 * mobile, which matches no lead. GET searches for the business, POST links it.
 * Both scoped in `lib/texts.ts`: a caller reaches only their own lists and
 * their own number's conversations.
 */
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) return Response.json({ leads: [] });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ leads: await searchLeadsToLink(me, q) });
}

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    their?: unknown;
    ours?: unknown;
    leadId?: unknown;
  } | null;
  const their = typeof body?.their === "string" ? body.their : "";
  const ours = typeof body?.ours === "string" ? body.ours : "";
  const leadId = Number(body?.leadId);
  if (!their || !ours || !Number.isInteger(leadId) || leadId <= 0) {
    return Response.json({ error: "Pick a business to link." }, { status: 400 });
  }
  const ok = await linkConversation(me, their, ours, leadId);
  if (!ok) {
    return Response.json(
      { error: "Couldn't link that. It may not be one of your businesses." },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}
