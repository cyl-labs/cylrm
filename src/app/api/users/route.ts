import { getCurrentUser } from "@/lib/session";
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_RE,
  normaliseUsername,
} from "@/lib/password";
import { createUser, findByUsername } from "@/lib/users";

/**
 * Add an employee.
 *
 * Admin only, and there is no self-signup: the app is an internal console
 * behind one domain, and an open registration form on it would be a way in
 * rather than a convenience. Whoever runs the floor creates the account and
 * hands over the password.
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
      { error: "A display name is required — it is what the stats show." },
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

  const role = body.role === "admin" ? "admin" : "caller";

  // Checked rather than caught: username is unique, and the raw constraint
  // error would reach the screen as "duplicate key value violates …".
  if (await findByUsername(username)) {
    return Response.json(
      { error: `Someone already signs in as ${username}.` },
      { status: 409 },
    );
  }

  const created = await createUser({ username, name, password, role });
  return Response.json(created, { status: 201 });
}
