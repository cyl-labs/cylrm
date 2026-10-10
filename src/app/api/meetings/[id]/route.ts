import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";

/**
 * One meeting, as the Meetings screen draws it (2026-10-10).
 *
 * Read by the dial card's "Demo on the spot" panel, which holds the meeting in
 * the browser rather than rendering it on the server: the dialler is a client
 * component that moves between leads without a page load, so a meeting made
 * mid-call and the contracts drafted against it have to be fetched again by
 * hand. Founders, and a closer on a meeting that is theirs to close. `/api` is
 * outside the middleware matcher, so this is the only guard.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin" && me.role !== "closer") {
    return Response.json({ error: "Not for callers." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting || (me.role === "closer" && meeting.closerUserId !== me.id)) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  return Response.json({ meeting });
}
