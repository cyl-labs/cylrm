import { NextResponse } from "next/server";
import { sendQuotaDigest } from "@/lib/quota-digest";

/**
 * The Friday quota digest.
 *
 * Its own job rather than a passenger on the callbacks tick, so the two read
 * apart in the worker log and one going wrong cannot take the other with it —
 * the same reasoning that gave the callbacks digest a route of its own.
 *
 * It runs on every five-minute tick and does nothing on all but a handful:
 * outside the Friday-evening-through-Sunday window it returns immediately, and
 * inside it the week is claimed by a unique index, so the second tick finds
 * nothing to send.
 *
 * **Unlike the callbacks job, this needs its migration applied first.** With
 * push configured — which it is in prod — the "nothing to do" branch is not
 * taken, so a missing `quota_digest_sent` is this throwing every five minutes.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sendQuotaDigest();
  return NextResponse.json({ ok: true, job: "quota", ...result });
}
