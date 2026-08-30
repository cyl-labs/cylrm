import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/session";
import { isAdminOnlyPath } from "@/lib/workspace";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(
    request,
    response,
    sessionOptions,
  );

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";
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

  // Callers get their own corner of the Call CRM and nothing else: no email
  // side, and no Stats, which is the floor's performance including everyone
  // else's numbers. The switcher and nav hide both, but a bookmark or a typed
  // URL would walk straight past that — this is the part that stops it. The
  // matching API routes guard themselves with `denyIfNotEmailUser`, since
  // `/api` is excluded from this matcher.
  if (signedIn && session.role !== "admin" && isAdminOnlyPath(pathname)) {
    return NextResponse.redirect(new URL("/calls", request.url));
  }

  return response;
}

export const config = {
  // `u` is the public unsubscribe page — recipients have no login, and
  // bouncing them to /login would make the link in every email dead.
  // `icon.png` has to be listed as well: it is the favicon Next generates the
  // link for, and the browser asks for it while signed out, on the login page
  // above all. Left in the matcher it redirects to /login and the browser is
  // handed HTML where it expected an image.
  //
  // `sw.js` is the same failure one step worse. The browser re-fetches a
  // service worker to check for updates on its own schedule, not as part of
  // any page load, so that request can easily carry a session that has since
  // expired — and a script fetch answered with the login page's HTML does not
  // merely fail, it can unregister the worker and silently end somebody's
  // reminders. It is a static file with nothing private in it.
  matcher: [
    "/((?!api|u/|_next/static|_next/image|favicon.ico|icon.png|sw.js).*)",
  ],
};
