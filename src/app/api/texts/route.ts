import { getCurrentUser } from "@/lib/session";
import { callerNumberOf, canSendTexts } from "@/lib/users";
import { classifyPhone, e164 } from "@/lib/phone";
import { sendSms } from "@/lib/telnyx";
import { explainTextError, recordOutbound, smsEnabled } from "@/lib/sms";
import { conversationOptedOut, leadForNumber } from "@/lib/texts";
import { conversationKey } from "@/lib/text-key";

/** Three texts' worth, the same cap the Meetings screen uses. */
const MAX_LENGTH = 480;

/**
 * Send a text from the Texts screen.
 *
 * Founders, plus any caller granted `text_access` on Team, and always from
 * their own number — the rule the Meetings button follows, for the same
 * reason: a text has to come from the number the person already knows, or it
 * reads as a stranger. The browser sends the words and who they are for; which
 * number they go out from is decided here, which is why the permission can be
 * handed out without anybody being able to text as somebody else.
 *
 * Kept apart from `/api/meetings/[id]/text` rather than folded into it, because
 * that route is addressed by meeting and this one by number: a reply to
 * somebody who texted us has no meeting behind it.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  // Admins always, and anyone an admin has granted it on Team. Reading this
  // screen was never the restricted part — `scope()` in `lib/texts.ts` already
  // limits a caller to the conversations on their own number — so the check is
  // here on the send and nowhere else.
  if (!(await canSendTexts(me.id, me.role))) {
    return Response.json(
      { error: "You have not been given permission to send texts." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    to?: unknown;
    text?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Write something to send." }, { status: 400 });
  }
  if (text.length > MAX_LENGTH) {
    return Response.json(
      { error: `Keep it under ${MAX_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const raw = typeof body?.to === "string" ? body.to : "";
  // US only because only US texting was registered with the carriers.
  const to = classifyPhone(raw) === "us" ? e164(raw) : null;
  if (!to) {
    return Response.json(
      { error: "Only US numbers can be texted." },
      { status: 400 },
    );
  }

  const from = await callerNumberOf(me.id);
  if (!from || classifyPhone(from) !== "us") {
    return Response.json(
      { error: "You need a US number to text from. Give your account one on Team." },
      { status: 400 },
    );
  }

  const lead = await leadForNumber(to);
  if (lead?.dncBlock) {
    return Response.json({ error: lead.dncBlock }, { status: 403 });
  }
  if (await conversationOptedOut(to, from)) {
    return Response.json({ error: explainTextError("40300") }, { status: 409 });
  }

  const sent = await sendSms(from, to, text);
  if (!sent.ok) {
    if (sent.code === "unreachable") {
      // The one failure that must not invite a second press: the request may
      // have reached Telnyx, and pressing again could text them twice.
      return Response.json(
        {
          error:
            "Couldn't get an answer from Telnyx, so the text may or may not have gone. Check before sending it again.",
        },
        { status: 502 },
      );
    }
    return Response.json(
      { error: explainTextError(sent.code, sent.detail) },
      { status: 422 },
    );
  }

  await recordOutbound({
    telnyxId: sent.id,
    from,
    to,
    body: text,
    status: sent.status,
    meetingId: lead?.meetingId ?? null,
    leadId: lead?.id ?? null,
    userId: me.id,
  });

  return Response.json({ ok: true, key: conversationKey(to, from) });
}
