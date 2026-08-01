import { type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo";
import { getSession } from "@/lib/session";

/**
 * Every workspace switch comes through here: /api/demo?on=1|0&to=/calls.
 *
 * `on` sets or clears demo mode and `to` picks the workspace to land in. Both
 * have to happen in one hop — when picking a live workspace only navigated and
 * left the cookie alone, choosing "Email CRM" from inside the demo kept you in
 * the demo, with no obvious way out.
 *
 * Relative Location only, see AGENTS.md.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn) {
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }

  const on = request.nextUrl.searchParams.get("on") === "1";
  const to = request.nextUrl.searchParams.get("to");
  let back = "/leads";
  if (to && to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/api")) {
    back = to;
  } else {
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        const path = new URL(referer).pathname;
        if (path.startsWith("/") && !path.startsWith("/api")) back = path;
      } catch {
        // keep default
      }
    }
  }

  const cookie = on
    ? `${DEMO_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`
    : `${DEMO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: { Location: back, "Set-Cookie": cookie },
  });
}
