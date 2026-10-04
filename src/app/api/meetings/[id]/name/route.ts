import { eq } from "drizzle-orm";
import { db } from "@/db";
import { callLead, callMeeting } from "@/db/schema";
import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";

const MAX_LENGTH = 80;

/**
 * Correct the name on a meeting (2026-10-05).
 *
 * **Why it exists**: a caller types the prospect's name wrong on the booking
 * form ("Arwin" for Irvin) and it then opens every text ("Hey Arwin") and goes
 * onto the contract. Cal.com cannot be told, because its API has no way to edit
 * an attendee, so the fix lives here: the name is stored on the meeting with a
 * flag (`attendee_name_edited`) that the sync respects, or the typo would come
 * back within five minutes. Cal.com's own emails keep the old spelling.
 *
 * **Written to the lead too**, when the meeting has one, which is what the next
 * booking prefills from. The same reasoning the guest-email route follows.
 *
 * Not admin-only: the caller who made the booking is the one who spots it. The
 * meeting is read through `callScope`, so a caller can only do this to their
 * own niches.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  // Collapsed whitespace, no control characters: this lands in a text message
  // and on a contract, so a stray newline is not harmless.
  const name =
    typeof body?.name === "string"
      ? body.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
      : "";
  if (name === "") {
    return Response.json({ error: "Type the name first." }, { status: 400 });
  }
  if (name.length > MAX_LENGTH) {
    return Response.json(
      { error: `Keep the name under ${MAX_LENGTH} characters.` },
      { status: 400 },
    );
  }

  // Scoped read: a caller naming a meeting on somebody else's niche gets the
  // same not-found as one that never existed.
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  await db
    .update(callMeeting)
    .set({ attendeeName: name, attendeeNameEdited: true })
    .where(eq(callMeeting.id, id));

  let savedToLead = false;
  if (meeting.leadId !== null) {
    await db
      .update(callLead)
      .set({ name })
      .where(eq(callLead.id, meeting.leadId));
    savedToLead = true;
  }

  return Response.json({ ok: true, name, savedToLead });
}
