import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
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
  if (await isDemoMode()) return demoReadOnlyResponse();

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

  const values: Partial<typeof appUser.$inferInsert> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      return Response.json({ error: "A name is required." }, { status: 400 });
    }
    values.name = name;
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
      { error: "Someone has to stay an admin — promote another first." },
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
