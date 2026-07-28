import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(
    request,
    response,
    sessionOptions,
  );

  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!session.loggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (session.loggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  // `u` is the public unsubscribe page — recipients have no login, and
  // bouncing them to /login would make the link in every email dead.
  matcher: ["/((?!api|u/|_next/static|_next/image|favicon.ico).*)"],
};
