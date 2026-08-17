import { getCurrentUser } from "@/lib/session";
import { TelnyxNotConfiguredError, mintCallToken } from "@/lib/telnyx";

/**
 * A short-lived browser credential for the signed-in caller.
 *
 * Returns the token and nothing else: never the credential id, the connection
 * id, or the API key.
 *
 * Requires a real user rather than just a session, which is one notch stricter
 * than `/api/calls`. A pre-login cookie that can write a call row is a
 * different thing from one that can place international calls on our account.
 */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return Response.json({ token: await mintCallToken(me.id) });
  } catch (err) {
    // Unconfigured is the steady state until the numbers are bought, so it is
    // reported rather than thrown: the dialler shows no dial button and every
    // other part of the screen works exactly as it does today.
    if (err instanceof TelnyxNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not mint a token." },
      { status: 502 },
    );
  }
}
