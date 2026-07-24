import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { domain, sendingAccount } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode } from "@/lib/google";
import { getSession } from "@/lib/session";

// Relative redirects only — absolute URLs built from request.url would leak
// the internal localhost origin behind Caddy (see AGENTS.md).
function redirectToAccounts(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: { Location: `/accounts${qs ? `?${qs}` : ""}` },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn) {
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }

  const search = request.nextUrl.searchParams;
  const oauthError = search.get("error");
  if (oauthError) {
    return redirectToAccounts({ google_error: oauthError });
  }

  const code = search.get("code");
  const state = search.get("state");
  const stateCookie = request.cookies.get("g_oauth_state")?.value;
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return redirectToAccounts({ google_error: "state_mismatch" });
  }

  let email: string;
  let refreshToken: string;
  try {
    ({ email, refreshToken } = await exchangeCode(code));
  } catch (err) {
    return redirectToAccounts({
      google_error: err instanceof Error ? err.message.slice(0, 200) : "exchange_failed",
    });
  }

  const encrypted = encryptSecret(refreshToken);
  const now = new Date();
  const [existing] = await db
    .select({ id: sendingAccount.id })
    .from(sendingAccount)
    .where(eq(sql`lower(${sendingAccount.email})`, email));

  if (existing) {
    await db
      .update(sendingAccount)
      .set({
        googleRefreshToken: encrypted,
        googleConnectedAt: now,
        needsReconnect: false,
      })
      .where(eq(sendingAccount.id, existing.id));
  } else {
    // New account connected via Google: create it under a domain named
    // after the email's domain part (same default as app-password connect).
    const domainName = email.split("@")[1] ?? "unknown";
    const [found] = await db
      .select({ id: domain.id })
      .from(domain)
      .where(eq(sql`lower(${domain.name})`, domainName.toLowerCase()));
    const domainId =
      found?.id ??
      (
        await db
          .insert(domain)
          .values({ name: domainName })
          .returning({ id: domain.id })
      )[0].id;
    await db.insert(sendingAccount).values({
      email,
      domainId,
      googleRefreshToken: encrypted,
      googleConnectedAt: now,
      needsReconnect: false,
      dailyCap: 20,
      active: true,
    });
  }

  const response = redirectToAccounts({ google_connected: email });
  // Clear the state cookie.
  return new Response(response.body, {
    status: 303,
    headers: {
      Location: response.headers.get("Location")!,
      "Set-Cookie":
        "g_oauth_state=; Path=/api/google; Max-Age=0; HttpOnly; SameSite=Lax",
    },
  });
}
