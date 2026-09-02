import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getCurrentUser, getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/password";
import { countActiveAdmins } from "@/lib/users";

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

  // The number they ring from. Checked against their market, because a US
  // number calling Singapore leads is worse than sharing a Singapore one.
  if ("telnyxDid" in body) {
    const did =
      typeof body.telnyxDid === "string" ? body.telnyxDid.trim() : "";
    if (did === "") {
      values.telnyxDid = null;
    } else if (!/^\+[1-9]\d{6,15}$/.test(did)) {
      return Response.json(
        { error: "A number has to be in E.164, like +6531258472." },
        { status: 400 },
      );
    } else {
      const region = ("callRegion" in body ? body.callRegion : target.callRegion) as
        | "sg"
        | "us"
        | "gb"
        | null;
      const prefix = { sg: "+65", us: "+1", gb: "+44" }[region ?? "sg"];
      if (region && !did.startsWith(prefix)) {
        return Response.json(
          {
            error: `That is not a ${
              { sg: "Singapore", us: "US", gb: "UK" }[region]
            } number. Their market decides which numbers they can ring from.`,
          },
          { status: 400 },
        );
      }
      values.telnyxDid = did;
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
    values.role = body.role === "admin" ? "admin" : "caller";
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
    (values.role === "caller" || values.active === false);
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

  return Response.json(row);
}
