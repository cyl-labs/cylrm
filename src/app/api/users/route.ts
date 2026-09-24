import { toRole } from "@/lib/roles";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_RE,
  normaliseUsername,
} from "@/lib/password";
import { createUser, findByUsername } from "@/lib/users";
import {
  LineSetupError,
  TelnyxNotConfiguredError,
  provisionLine,
} from "@/lib/telnyx";
import { isMarket, numberProblem } from "@/lib/team-numbers";

/**
 * Add an employee, and give them a phone that works.
 *
 * Admin only, and there is no self-signup: the app is an internal console
 * behind one domain, and an open registration form on it would be a way in
 * rather than a convenience. Whoever runs the floor creates the account and
 * hands over the password.
 *
 * Since 2026-09-15 this is also the whole of setting somebody up to call. Their
 * market and how they dial are set here, and a number picked here gets a
 * Telnyx line built for it (`provisionLine`), so a new hire can dial out and be
 * rung back from their first sign-in. That used to be a separate round of
 * Telnyx configuration done by hand, which is exactly how two callers went
 * weeks with numbers that rang nobody.
 *
 * A line that fails to build does not undo the account: the person exists and
 * can sign in, and the response says what is left to do, which is picking the
 * number again on their row.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json(
      { error: "Only an admin can add people." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    name?: unknown;
    password?: unknown;
    role?: unknown;
    callRegion?: unknown;
    dialMethod?: unknown;
    telnyxDid?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = normaliseUsername(
    typeof body.username === "string" ? body.username : "",
  );
  if (!USERNAME_RE.test(username)) {
    return Response.json(
      {
        error:
          "Username must be 2–30 characters: letters, numbers, dot, dash or underscore.",
      },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") {
    return Response.json(
      { error: "A display name is required: it is what the stats show." },
      { status: 400 },
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const role = toRole(body.role);
  const callRegion = isMarket(body.callRegion) ? body.callRegion : null;
  const dialMethod = body.dialMethod === "handset" ? "handset" : "browser";

  // Somebody dialling from their own phone has no use for one of ours, which
  // is also why the Team screen greys the number out for them.
  const did =
    dialMethod === "browser" && typeof body.telnyxDid === "string"
      ? body.telnyxDid.trim()
      : "";
  if (did) {
    const problem = numberProblem(did, callRegion);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }

  // Checked rather than caught: username is unique, and the raw constraint
  // error would reach the screen as "duplicate key value violates …".
  if (await findByUsername(username)) {
    return Response.json(
      { error: `Someone already signs in as ${username}.` },
      { status: 409 },
    );
  }

  const created = await createUser({
    username,
    name,
    password,
    role,
    callRegion,
    dialMethod,
  });

  let number: string | null = null;
  let lineWarning: string | undefined;
  if (did) {
    try {
      const line = await provisionLine(
        { id: created.id, username: created.username, telnyxConnectionId: null },
        did,
      );
      await db
        .update(appUser)
        .set({ telnyxDid: did, telnyxConnectionId: line.connectionId })
        .where(eq(appUser.id, created.id));
      number = did;
    } catch (err) {
      if (err instanceof TelnyxNotConfiguredError) {
        // No Telnyx here, so there is no line to build: the number is still
        // theirs, which is all it ever was before lines existed.
        await db
          .update(appUser)
          .set({ telnyxDid: did })
          .where(eq(appUser.id, created.id));
        number = did;
      } else {
        console.error("[team] line setup failed for a new person", err);
        lineWarning =
          err instanceof LineSetupError
            ? `${err.message} They can sign in, but have no number yet.`
            : "They can sign in, but their phone line could not be set up on Telnyx. Pick their number again on their row to retry.";
      }
    }
  }

  return Response.json({ ...created, number, lineWarning }, { status: 201 });
}
