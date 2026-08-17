import { sql } from "drizzle-orm";
import { db } from "@/db";
import { callScope, getCurrentUser } from "@/lib/session";
import { recordingDownloadUrl } from "@/lib/telnyx";

/**
 * Play a recording.
 *
 * Telnyx's own URLs are presigned and expire ten minutes after the webhook, so
 * nothing stores them. This mints a fresh one per play, which is why the link
 * on a lead still works a month later.
 *
 * The id must already be in `call_recording`, and the call it belongs to must
 * be on a list this person can see. Without that check this is a general proxy
 * into every recording on the Telnyx account for anyone with a login.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ownerId = callScope(me);

  const rows = (await db.execute(sql`
    select r.recording_id
    from call_recording r
    join call c on c.telnyx_session_id = r.call_session_id
    join call_lead l on l.id = c.call_lead_id
    join call_list cl on cl.id = l.call_list_id
    where r.recording_id = ${id}
      ${ownerId === undefined ? sql`` : sql`and cl.assigned_user_id = ${ownerId}`}
    limit 1
  `)) as { recording_id: string }[];

  if (rows.length === 0) {
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
