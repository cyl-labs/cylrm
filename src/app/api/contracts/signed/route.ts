import { NextResponse } from "next/server";
import { markContractSigned } from "@/lib/contracts";

/**
 * "The client signed it" — called by n8n, not by a browser.
 *
 * DocuSeal's `submission.completed` webhook goes to n8n, which downloads the
 * signed PDF and drafts it into Gmail; this is the same workflow telling the
 * CRM, so there is one path for that fact rather than two that can disagree.
 * The CRM cannot ask DocuSeal on a schedule instead — that would be a poll of a
 * shared instance for an event that already knows how to announce itself.
 *
 * Guarded by `CRON_SECRET`, exactly as the cron routes are: this has no session
 * and never will, and `/api` is outside the middleware matcher, so the bearer
 * token is the only guard there is.
 *
 * Answers 200 for a submission it does not recognise. That is not laxness: the
 * DocuSeal instance is shared with another business, so most submissions on it
 * are genuinely none of our business, and a 4xx would have DocuSeal — via n8n —
 * retrying ten times over somebody else's contract.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    submissionId?: unknown;
    completedAt?: unknown;
  } | null;

  const submissionId = Number(body?.submissionId);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return NextResponse.json(
      { error: "submissionId is required" },
      { status: 400 },
    );
  }

  // The moment DocuSeal recorded, when it sends one. Falling back to now()
  // rather than refusing: a signature that lands with a missing timestamp is
  // still a signature, and being a few seconds out is not worth dropping it.
  const at =
    typeof body?.completedAt === "string" && !Number.isNaN(Date.parse(body.completedAt))
      ? new Date(body.completedAt)
      : new Date();

  const result = await markContractSigned(submissionId, at);
  return NextResponse.json({ ok: true, ...result });
}
