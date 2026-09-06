import { getCurrentUser } from "@/lib/session";
import { findVisibleRecording } from "@/lib/recordings";
import { recordingDownloadUrl } from "@/lib/telnyx";

/**
 * Play a recording.
 *
 * Telnyx's own URLs are presigned and expire ten minutes after the webhook, so
 * nothing stores them. This mints a fresh one per play, which is why the link
 * on a lead still works a month later.
 *
 * Who may hear what is `findVisibleRecording`, shared with the transcript
 * routes. Without a check of some kind this is a general proxy into every
 * recording on the Telnyx account for anyone with a login.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await findVisibleRecording(id, me))) {
    return Response.json({ error: "Recording not found." }, { status: 404 });
  }

  const url = await recordingDownloadUrl(id).catch(() => null);
  if (!url) {
    return Response.json(
      { error: "Telnyx has no download for that recording." },
      { status: 502 },
    );
  }

  // Never cached: the URL behind it expires, so a cached redirect would be a
  // link that works once and then quietly does not.
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
