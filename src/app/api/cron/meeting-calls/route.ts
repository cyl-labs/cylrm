import { NextResponse } from "next/server";
import { hasCronAuth } from "@/lib/bearer";
import { processMeetingCalls } from "@/lib/meeting-calls";

/**
 * Transcribe the calls that belong to a meeting and read them for a promised
 * call back. Its own job, like every other one here: it can be slow (audio is
 * fetched and sent out) and a failure must not take another job down.
 *
 * **Needs its migration applied first** (`2026-10-02-recording-auto.sql`).
 */
export async function POST(request: Request) {
  if (!hasCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processMeetingCalls();
  return NextResponse.json({ ok: true, job: "meeting-calls", ...result });
}
