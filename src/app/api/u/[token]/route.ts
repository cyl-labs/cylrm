import { NextResponse } from "next/server";
import { unsubscribeByContactId } from "@/lib/unsubscribe";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/**
 * One-click unsubscribe target (RFC 8058).
 *
 * Deliberately unauthenticated — the recipient has no login, and the signed
 * token is the authority. POST is what mail clients call for one-click; GET
 * is what a human following a stray link gets, so it hands them the
 * confirmation page rather than acting on a link preview fetch.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const contactId = verifyUnsubscribeToken(token);
  if (contactId === null) {
    return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  }
  const result = await unsubscribeByContactId(contactId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Relative Location on purpose. Building an absolute URL from request.url
  // leaks the internal localhost:3005 origin behind Caddy — the same trap the
  // login/logout handlers document.
  return new Response(null, {
    status: 303,
    headers: { Location: `/u/${encodeURIComponent(token)}` },
  });
}
