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
  // `userId` is required, not just `loggedIn`: a cookie issued before staff
  // logins existed passes the old test but says nothing about who is holding
  // it, and every call it logged would be unattributed. Those sessions sign
  // in again once.
  const signedIn = Boolean(session.loggedIn && session.userId);

  if (!signedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  // `u` is the public unsubscribe page — recipients have no login, and
  // bouncing them to /login would make the link in every email dead.
  matcher: ["/((?!api|u/|_next/static|_next/image|favicon.ico).*)"],
};
