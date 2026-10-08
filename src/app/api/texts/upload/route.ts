import { getCurrentUser } from "@/lib/session";
import { canSendTexts } from "@/lib/users";
import { smsEnabled } from "@/lib/sms";
import { OUT_MAX_BYTES, saveOutgoing, sniffImage } from "@/lib/sms-out-media";

/**
 * Keep a picture so it can be texted, `multipart/form-data` with a `file`
 * (2026-10-09). Returns `{ id }`, which the send routes take as `mediaId`.
 *
 * Only somebody who may send texts: the picture ends up at a public link, so it
 * is not offered to anybody who could not use it. Sending is still checked on
 * its own route; this only stores bytes. The type is read from the bytes, since
 * the label the browser sends is the one thing here a person controls.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) {
    return Response.json({ error: "Texting is switched off." }, { status: 404 });
  }
  if (!(await canSendTexts(me.id, me.role))) {
    return Response.json(
      { error: "You have not been given permission to send texts." },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No picture came with that." }, { status: 400 });
  }
  if (file.size > OUT_MAX_BYTES) {
    return Response.json(
      { error: "That picture is too big to text. Pick a smaller one." },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) {
    return Response.json(
      { error: "Only JPEG, PNG or GIF pictures can be texted." },
      { status: 415 },
    );
  }
  const id = await saveOutgoing(bytes, type);
  return Response.json({ id, size: bytes.length, contentType: type });
}
