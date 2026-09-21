import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_RE,
  hashPassword,
  normaliseUsername,
} from "@/lib/password";
import { findByUsername } from "@/lib/users";
import { smsEnabled } from "@/lib/sms";
import { TelnyxNotConfiguredError, handOverLine } from "@/lib/telnyx";

/**
 * Replace a caller who is leaving with somebody new, in one step.
 *
 * Callers change often, and the handover used to be half a dozen separate
 * jobs — make an account, move the number, rebuild a phone line, move the
 * niches, switch the old account off — each of which was easy to forget and
 * silent when forgotten. This does all of it in one transaction:
 *
 * - **A new account** with the leaver's market, dialling method, keypad and
 *   hints settings, because the job is the same job.
 * - **The number and the line move with it.** The number already points at the
 *   leaver's line, so handing over the line means nothing about routing
 *   changes and a prospect ringing back reaches the new person at once. The
 *   line is renamed and its password changed afterwards (`handOverLine`).
 * - **Their call lists move**, and callbacks with them, since a callback
 *   belongs to the niche it is on.
 * - **Missed calls still owed a ring back, and texts to that number, move** —
 *   the promise and the conversation are the number's, not the leaver's.
 * - **The old account is switched off**, which also ends any session it holds.
 *
 * What does not move is theirs to keep: the calls they logged, their pay and
 * payouts, and the ring-backs they already did. Stats and Payroll go on
 * showing their work under their name.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can replace people." },
      { status: 403 },
    );
  }

  const outgoingId = Number((await params).id);
  if (!Number.isInteger(outgoingId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    username?: unknown;
    password?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const username = normaliseUsername(
    typeof body?.username === "string" ? body.username : "",
  );
  const password = typeof body?.password === "string" ? body.password : "";
  if (name === "") {
    return Response.json(
      { error: "A display name is required: it is what the stats show." },
      { status: 400 },
    );
  }
  if (!USERNAME_RE.test(username)) {
    return Response.json(
      {
        error:
          "Username must be 2–30 characters: letters, numbers, dot, dash or underscore.",
      },
      { status: 400 },
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const [outgoing] = await db
    .select()
    .from(appUser)
    .where(eq(appUser.id, outgoingId));
  if (!outgoing) {
    return Response.json({ error: "Person not found." }, { status: 404 });
  }
  // Only callers. An admin's account is the founders' own business, and a
  // switched-off one has nothing live left to hand over — add the new person
  // instead.
  if (outgoing.role !== "caller" || outgoing.isOwner) {
    return Response.json(
      { error: "Only a caller can be replaced." },
      { status: 400 },
    );
  }
  if (!outgoing.active) {
    return Response.json(
      {
        error: `${outgoing.name} is already switched off. Use Add person for their replacement.`,
      },
      { status: 400 },
    );
  }
  if (await findByUsername(username)) {
    return Response.json(
      { error: `Someone already signs in as ${username}.` },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  const moved = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(appUser)
      .values({
        username,
        name,
        passwordHash,
        role: "caller",
        callRegion: outgoing.callRegion,
        statsRegion: outgoing.statsRegion,
        dialMethod: outgoing.dialMethod,
        keypadAccess: outgoing.keypadAccess,
        liveHints: outgoing.liveHints,
        // Inherited like the other two: a replacement takes over the leaver's
        // seat, and re-granting permissions by hand is how somebody ends up
        // unable to answer a prospect who texts the number they just took on.
        textAccess: outgoing.textAccess,
        panelLeft: outgoing.panelLeft,
        telnyxDid: outgoing.telnyxDid,
        telnyxConnectionId: outgoing.telnyxConnectionId,
      })
      .returning({ id: appUser.id, username: appUser.username });

    // The credential lives under the line, and the new person mints their own
    // on first sign-in, so the leaver's goes rather than being inherited.
    await tx
      .update(appUser)
      .set({
        active: false,
        telnyxDid: null,
        telnyxConnectionId: null,
        telnyxCredentialId: null,
        telnyxCredentialExpiresAt: null,
      })
      .where(eq(appUser.id, outgoing.id));

    const lists = (await tx.execute(sql`
      update call_list set assigned_user_id = ${created.id}
      where assigned_user_id = ${outgoing.id}
      returning id
    `)) as unknown[];
    const missed = (await tx.execute(sql`
      update inbound_call set user_id = ${created.id}
      where user_id = ${outgoing.id}
        and answered_at is null and handled_at is null
      returning id
    `)) as unknown[];
    // The table only exists once texting has been switched on.
    const texts = smsEnabled()
      ? ((await tx.execute(sql`
          update call_sms set user_id = ${created.id}
          where user_id = ${outgoing.id} and direction = 'in'
          returning id
        `)) as unknown[])
      : [];

    return {
      created,
      lists: lists.length,
      missedCalls: missed.length,
      texts: texts.length,
    };
  });

  let lineWarning: string | undefined;
  if (outgoing.telnyxConnectionId) {
    try {
      await handOverLine({
        connectionId: outgoing.telnyxConnectionId,
        username,
        outgoingUserId: outgoing.id,
        outgoingCredentialId: outgoing.telnyxCredentialId,
      });
    } catch (err) {
      if (!(err instanceof TelnyxNotConfiguredError)) {
        // Everything that matters has already moved: the number rings the new
        // person. What failed is the tidy-up, so it is said, not refused.
        console.error("[team] line handover failed", err);
        lineWarning = `Everything moved to ${name}, but Telnyx did not confirm the phone line's new password. It is worth replacing again later.`;
      }
    }
  }

  return Response.json({
    id: moved.created.id,
    username: moved.created.username,
    number: outgoing.telnyxDid,
    moved: {
      lists: moved.lists,
      missedCalls: moved.missedCalls,
      texts: moved.texts,
    },
    lineWarning,
  });
}
