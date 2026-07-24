import { type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo";
import { getSession } from "@/lib/session";

/** Toggle demo mode: /api/demo?on=1 or ?on=0. Redirects back to the page
 * the click came from (relative Location only — see AGENTS.md). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn) {
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }

  const on = request.nextUrl.searchParams.get("on") === "1";
  let back = "/leads";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const path = new URL(referer).pathname;
      if (path.startsWith("/") && !path.startsWith("/api")) back = path;
    } catch {
      // keep default
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
