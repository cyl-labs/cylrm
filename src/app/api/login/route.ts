import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { findByUsername, touchLastSeen } from "@/lib/users";

/**
 * What an unknown username is checked against.
 *
 * Without it, a missing account returns in a millisecond and a real one takes
 * the ~50ms scrypt costs, which tells an attacker which usernames exist.
 * Hashed once per process, of a random string nothing can match.
 */
let dummyHash: Promise<string> | null = null;
const unmatchableHash = () =>
  (dummyHash ??= hashPassword(randomBytes(32).toString("hex")));

/**
 * Sign in as an employee.
 *
 * One shared password used to be the whole of auth. It cannot answer "who
 * made this call", which is the point of having accounts, so it is gone —
 * APP_PASSWORD now only seeds the first admin (scripts/bootstrap-admin.mjs).
 *
 * Every failure says the same thing. Telling an attacker that a username
 * exists but the password is wrong hands them half the answer, and there is
 * nothing an employee can do differently for the two cases anyway.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const username = form.get("username");
  const password = form.get("password");

  const fail = () =>
    new Response(null, {
      status: 303,
      headers: { Location: "/login?error=1" },
    });

  if (typeof username !== "string" || typeof password !== "string") {
    return fail();
  }

  const user = await findByUsername(username);
  // A hash is always verified, even with no such user, so the response time
  // does not say whether the name exists.
  const ok = await verifyPassword(
    password,
    user?.passwordHash ?? (await unmatchableHash()),
  );
  if (!user || !ok || !user.active) return fail();

  const session = await getSession();
  session.loggedIn = true;
  session.userId = user.id;
  session.userName = user.name;
  session.role = user.role;
  await session.save();

  await touchLastSeen(user.id);

  return new Response(null, { status: 303, headers: { Location: "/" } });
}
