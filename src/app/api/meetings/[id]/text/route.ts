import { getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";
import { callerNumberOf, canSendTexts } from "@/lib/users";
import { classifyPhone, e164 } from "@/lib/phone";
import { sendSms } from "@/lib/telnyx";
import {
  explainTextError,
  isOptedOut,
  recordOutbound,
  settleOutbound,
  smsEnabled,
} from "@/lib/sms";
import { resolveOutgoing } from "@/lib/sms-out-media";

/** Three texts' worth. Anything longer is not "I'm calling you now". */
const MAX_LENGTH = 480;

/**
 * Text the prospect on a meeting, from the sender's own number.
 *
 * Admin-only: the demo is a founder's call, and the campaign registered with
 * the carriers is for exactly this message. The words arrive from the browser
 * and go out untouched; everything else — who is texted, from which number —
 * is decided here from the database, so a request cannot aim a text anywhere
 * the meeting row does not.
 *
 * From the sender's own `telnyx_did` rather than any number on the account,
 * because the text follows a missed call: it has to come from the number that
 * just rang them, or it reads as a stranger.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Before anything else: switched off, this route should reveal nothing.
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  // Admins always, plus any caller granted it on Team. The number is still
  // their own, so a permission granted here cannot text as somebody else.
  const mayText = await canSendTexts(me.id, me.role);

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    mediaId?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  // One picture at most (2026-10-09); with one, the words are optional.
  const media = await resolveOutgoing(body?.mediaId);
  if (media && "error" in media) {
    return Response.json({ error: media.error }, { status: 400 });
  }
  if (!text && !media) {
    return Response.json({ error: "Write something to send." }, { status: 400 });
  }
  const mediaUrls = media ? [media.url] : [];
  const mediaRecord = media
    ? [{ url: media.url, contentType: media.contentType, size: media.size, hash: null }]
    : null;
  if (text.length > MAX_LENGTH) {
    return Response.json(
      { error: `Keep it under ${MAX_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const meeting = await getMeeting(id);
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (meeting.training) {
    // A practice meeting (2026-10-06): a real text, from the closer's own
    // number to the colleague playing the prospect on their CRM line. Open to
    // a founder and the closer it was handed to without the Team permission,
    // since it never reaches a business. Nothing is tied to a lead.
    if (me.role !== "admin" && meeting.closerUserId !== me.id) {
      return Response.json({ error: "That meeting is not yours." }, { status: 403 });
    }
    const practiceTo = meeting.dialTo;
    const practiceFrom = await callerNumberOf(me.id);
    if (!practiceTo || classifyPhone(practiceTo) !== "us") {
      return Response.json(
        { error: "The practice prospect has no US number to text." },
        { status: 400 },
      );
    }
    if (!practiceFrom || classifyPhone(practiceFrom) !== "us") {
      return Response.json(
        { error: "You need a US number to text from. Give your account one on Team." },
        { status: 400 },
      );
    }
    const practiceSent = await sendSms(practiceFrom, practiceTo, text, mediaUrls);
    if (!practiceSent.ok) {
      return Response.json(
        {
          error:
            practiceSent.code === "unreachable"
              ? "Couldn't get an answer from Telnyx, so the text may or may not have gone. Check before sending it again."
              : explainTextError(practiceSent.code, practiceSent.detail),
        },
        { status: practiceSent.code === "unreachable" ? 502 : 422 },
      );
    }
    await recordOutbound({
      telnyxId: practiceSent.id,
      from: practiceFrom,
      to: practiceTo,
      body: text || "[You sent a picture]",
      status: practiceSent.status,
      meetingId: null,
      leadId: null,
      userId: me.id,
      media: mediaRecord,
    });
    void settleOutbound(practiceSent.id);
    return Response.json({ ok: true });
  }
  if (!mayText) {
    return Response.json(
      { error: "You have not been given permission to send texts." },
      { status: 403 },
    );
  }
  if (meeting.leadId === null || !meeting.phone) {
    return Response.json(
      { error: "This booking has no phone number to text." },
      { status: 400 },
    );
  }
  // Screening refuses a text for the same reason it hides the number.
  if (meeting.dncBlock) {
    return Response.json({ error: meeting.dncBlock }, { status: 403 });
  }
  // US only, and not a limit of the code: the campaign covers US numbers
  // texting US numbers, and nothing else was registered.
  const to = classifyPhone(meeting.phone) === "us" ? e164(meeting.phone) : null;
  if (!to) {
    return Response.json(
      { error: "Only US numbers can be texted." },
      { status: 400 },
    );
  }

  const from = await callerNumberOf(me.id);
  if (!from || classifyPhone(from) !== "us") {
    return Response.json(
      {
        error:
          "You need a US number to text from. Give your account one on Team.",
      },
      { status: 400 },
    );
  }

  // Telnyx would refuse it anyway. Asking first means the screen can say why
  // instead of passing on an error code.
  if (await isOptedOut(meeting.leadId)) {
    return Response.json({ error: explainTextError("40300") }, { status: 409 });
  }

  const sent = await sendSms(from, to, text, mediaUrls);
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
    body: text || "[You sent a picture]",
    status: sent.status,
    meetingId: meeting.id,
    leadId: meeting.leadId,
    userId: me.id,
    media: mediaRecord,
  });
  void settleOutbound(sent.id);

  return Response.json({ ok: true });
}
