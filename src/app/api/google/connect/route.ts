import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl } from "@/lib/google";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn) {
    // Relative Location — absolute URLs from request.url leak the internal
    // origin behind Caddy (see AGENTS.md).
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const loginHint = request.nextUrl.searchParams.get("email") ?? undefined;
  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildAuthUrl(state, loginHint), 303);
  response.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google",
  });
  return response;
}
