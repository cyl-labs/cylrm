import { db } from "@/db";
import { keypadCall } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { canUseKeypad } from "@/lib/users";

/**
 * Record a number dialled from the Keypad.
 *
 * Writes `keypad_call` and nothing else — never a `call` row, which would put
 * a test dial into the Stats tiles, the pipeline board, the Scoreboard and
 * somebody's pickup count. The one place these surface is the "Every call"
 * table on Stats.
 *
 * Posted when a leg ends rather than when it is dialled, because the duration
 * and Telnyx's session id are only known then. A conference is two legs and so
 * two posts.
 *
 * Guarded by the same grant that opens the screen: `/api` is outside the
 * middleware matcher, so a route that only checked the session would let any
 * signed-in caller write rows from a screen they cannot open.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canUseKeypad(me.id, me.role))) {
    return Response.json({ error: "No keypad access." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    label?: unknown;
    fromDid?: unknown;
    telnyxSessionId?: unknown;
    durationSeconds?: unknown;
    addedToCall?: unknown;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // E.164 and nothing else. The Keypad will not dial anything that fails
  // `e164`, so a value that fails here is a bug rather than a caller's typo,
  // and storing it would leave a row nothing downstream can read as a number.
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!/^\+\d{6,17}$/.test(phone)) {
    return Response.json({ error: "Invalid number." }, { status: 400 });
  }

  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;

  const [row] = await db
    .insert(keypadCall)
    .values({
      // From the session, never the body: a client-supplied user id would let
      // anyone file calls under a colleague's name.
      userId: me.id,
      phone,
      label: text(body.label, 200),
      fromDid: text(body.fromDid, 40),
      telnyxSessionId: text(body.telnyxSessionId, 200),
      durationSeconds:
        typeof body.durationSeconds === "number" &&
        Number.isFinite(body.durationSeconds)
          ? Math.max(0, Math.round(body.durationSeconds))
          : null,
      addedToCall: body.addedToCall === true,
    })
    .returning({ id: keypadCall.id, calledAt: keypadCall.calledAt });

  return Response.json({
    id: row.id,
    calledAt: row.calledAt.toISOString(),
  });
}
