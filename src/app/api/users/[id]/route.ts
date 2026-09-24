import { toRole } from "@/lib/roles";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getCurrentUser, getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/password";
import { countActiveAdmins } from "@/lib/users";
import {
  LineSetupError,
  TelnyxNotConfiguredError,
  linkTextingCampaign,
  provisionLine,
  unlinkTextingCampaign,
} from "@/lib/telnyx";
import { isMarket, numberProblem } from "@/lib/team-numbers";

/**
 * Rename someone, reset their password, change their role, or switch them off.
 *
 * Deactivating rather than deleting is the whole design: the calls stay, the
 * numbers stay, and the login stops. Deleting a person would either orphan
 * their calls or take a slice out of the stats.
 *
 * Two guards, both about not locking everyone out:
 *  - the last active admin cannot be demoted or deactivated, and
 *  - an admin cannot deactivate themselves, which is the accidental version
 *    of the same mistake.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can change people." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    password?: unknown;
    role?: unknown;
    active?: unknown;
    callRegion?: unknown;
    paymentMethod?: unknown;
    telnyxDid?: unknown;
    dialMethod?: unknown;
    keypadAccess?: unknown;
    textAccess?: unknown;
    liveHints?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(appUser)
    .where(eq(appUser.id, userId));
  if (!target) {
    return Response.json({ error: "Person not found." }, { status: 404 });
  }

  // Read from the row, not the session: the cookie is only refreshed at
  // sign-in, and whether someone is the owner must not depend on when they
  // last logged in.
  const [actor] = await db
    .select({ isOwner: appUser.isOwner })
    .from(appUser)
    .where(eq(appUser.id, me.id));

  // An admin may run the team; only the owner may touch the owner. Enforced
  // here rather than by hiding the buttons, since a hidden button is one
  // fetch away from being pressed anyway. Editing your own name or password
  // stays open, or the owner could not change their own details either.
  const touchesOwner =
    target.isOwner &&
    !actor?.isOwner &&
    ("role" in body || "active" in body || "password" in body);
  if (touchesOwner) {
    return Response.json(
      {
        error:
          "That is the founders' account. Another admin cannot change its role, switch it off, or reset its password.",
      },
      { status: 403 },
    );
  }

  const values: Partial<typeof appUser.$inferInsert> = {};
  // Set once the texting grant is decided below, and reported alongside the
  // save rather than blocking it: the permission is a database column and
  // must not fail to save over an unreachable Telnyx, the same reasoning
  // `provisionLine`'s messaging-profile step follows.
  let telnyxWarning: string | undefined;

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      return Response.json({ error: "A name is required." }, { status: 400 });
    }
    values.name = name;
  }

  // Which market they work, and so which script they are shown. Null is
  // allowed and means "every region" — an admin reviewing both wants that,
  // and it is what a new account has before anyone sets it.
  if ("callRegion" in body) {
    const region = body.callRegion;
    if (region !== null && !["sg", "us", "gb"].includes(region as string)) {
      return Response.json(
        { error: "Region must be sg, us, gb, or empty." },
        { status: 400 },
      );
    }
    values.callRegion = region as "sg" | "us" | "gb" | null;
  }

  // How they prefer to be paid. Free text — a PayNow number, a bank and
  // account, a Wise or PayPal link — because any fixed list of methods would be
  // wrong within a month. Blanked to null rather than stored as "" so "not set"
  // is one value and not two.
  if ("paymentMethod" in body) {
    if (body.paymentMethod !== null && typeof body.paymentMethod !== "string") {
      return Response.json(
        { error: "Invalid payment method." },
        { status: 400 },
      );
    }
    const method = (body.paymentMethod ?? "").trim();
    if (method.length > 500) {
      return Response.json(
        { error: "That payment method is too long." },
        { status: 400 },
      );
    }
    values.paymentMethod = method || null;
  }

  if ("dialMethod" in body) {
    if (body.dialMethod !== "browser" && body.dialMethod !== "handset") {
      return Response.json(
        { error: "Dial method must be browser or handset." },
        { status: 400 },
      );
    }
    values.dialMethod = body.dialMethod;
  }

  // One permission, not a rank: it opens the Keypad and nothing else. Stored
  // for callers only in practice — an admin has it by being an admin, and
  // `canUseKeypad` never reads the column for them.
  if ("liveHints" in body) {
    if (typeof body.liveHints !== "boolean") {
      return Response.json({ error: "Invalid value." }, { status: 400 });
    }
    values.liveHints = body.liveHints;
  }

  if ("keypadAccess" in body) {
    if (typeof body.keypadAccess !== "boolean") {
      return Response.json(
        { error: "Keypad access must be true or false." },
        { status: 400 },
      );
    }
    values.keypadAccess = body.keypadAccess;
  }

  if ("textAccess" in body) {
    if (typeof body.textAccess !== "boolean") {
      return Response.json(
        { error: "Text access must be true or false." },
        { status: 400 },
      );
    }
    values.textAccess = body.textAccess;

    // The Telnyx half of the grant: sending needs the number linked to the
    // 10DLC campaign, not just the `cylrm-sms` profile `provisionLine` already
    // puts it on. Only fires on an actual flip, and only when there is a
    // number to link — text_access on somebody with no DID yet has nothing to
    // do here. Best effort: a Telnyx failure is reported below, not refused,
    // because the alternative is the exact silent gap Brian hit on
    // 2026-09-22, where the grant saved and nothing said texting still would
    // not work.
    if (body.textAccess !== target.textAccess && target.telnyxDid) {
      try {
        if (body.textAccess) {
          await linkTextingCampaign(target.telnyxDid);
        } else {
          await unlinkTextingCampaign(target.telnyxDid);
        }
      } catch (err) {
        if (!(err instanceof TelnyxNotConfiguredError)) {
          console.error("[team] 10DLC campaign link failed", err);
          telnyxWarning = body.textAccess
            ? "Saved, but Telnyx didn't confirm the campaign link — texts from their number may keep failing until this is retried."
            : "Saved, but Telnyx didn't confirm the number came off the campaign — check it directly if that matters.";
        }
      }
    }
  }

  // The number they ring from. Checked against their market, because a US
  // number calling Singapore leads is worse than sharing a Singapore one.
  if ("telnyxDid" in body) {
    const did =
      typeof body.telnyxDid === "string" ? body.telnyxDid.trim() : "";
    if (did === "") {
      values.telnyxDid = null;
    } else {
      // The same rule Add person applies, from one place.
      const market = "callRegion" in body ? body.callRegion : target.callRegion;
      const problem = numberProblem(did, isMarket(market) ? market : null);
      if (problem) return Response.json({ error: problem }, { status: 400 });
      values.telnyxDid = did;

      // Assigning a number is also what makes it ring them: a line of their
      // own, the number pointed at it and put on the texting profile. Done
      // before the row is saved, so a number that cannot be set up is refused
      // with a reason rather than saved and left ringing nobody. Skipped when
      // Telnyx is not configured, the rule every optional integration follows.
      if (did !== target.telnyxDid || !target.telnyxConnectionId) {
        try {
          const line = await provisionLine(
            {
              id: target.id,
              username: target.username,
              telnyxConnectionId: target.telnyxConnectionId,
            },
            did,
          );
          values.telnyxConnectionId = line.connectionId;
        } catch (err) {
          if (!(err instanceof TelnyxNotConfiguredError)) {
            console.error("[team] line setup failed", err);
            return Response.json(
              {
                error:
                  err instanceof LineSetupError
                    ? err.message
                    : "Couldn't set up their phone line on Telnyx, so the number was not saved. Try again in a minute.",
              },
              { status: 502 },
            );
          }
        }
      }
    }
  }

  if ("password" in body) {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return Response.json(
        {
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }
    values.passwordHash = await hashPassword(password);
  }

  if ("role" in body) {
    values.role = toRole(body.role);
  }

  if ("active" in body) {
    values.active = Boolean(body.active);
    if (!values.active && target.id === me.id) {
      return Response.json(
        { error: "You cannot switch off your own account." },
        { status: 400 },
      );
    }
  }

  // One check covers both routes to zero admins: demoting the last one and
  // deactivating the last one.
  const losingAdmin =
    target.role === "admin" &&
    target.active &&
    ((values.role !== undefined && values.role !== "admin") || values.active === false);
  if (losingAdmin && (await countActiveAdmins()) <= 1) {
    return Response.json(
      { error: "Someone has to stay an admin: promote another first." },
      { status: 400 },
    );
  }

  if (Object.keys(values).length === 0) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const [row] = await db
    .update(appUser)
    .set(values)
    .where(eq(appUser.id, userId))
    .returning({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      role: appUser.role,
      active: appUser.active,
    });

  // The session carries a copy of the name and role so the sidebar and the
  // call routes do not query for them. Editing yourself has to refresh it, or
  // the header greets you by the old name until you sign in again.
  if (target.id === me.id) {
    const session = await getSession();
    session.userName = row.name;
    session.role = row.role;
    await session.save();
  }

  return Response.json(telnyxWarning ? { ...row, warning: telnyxWarning } : row);
}
