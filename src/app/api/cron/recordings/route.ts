import { NextResponse } from "next/server";
import { sweepRecordingGaps } from "@/lib/recording-gaps";

/**
 * Calls that connected and never got a recording.
 *
 * Its own job rather than a passenger on another tick, for the reason every
 * other job here has one: the two read apart in the worker log and one going
 * wrong cannot take the other with it.
 *
 * Unlike the callbacks, quota and payroll digests beside it, this does *not*
 * return early outside some window. Those report on a day that is over; this
 * reports a fault that may still be happening, and the whole point is hearing
 * about it during the shift rather than three days later. It is still cheap on
 * an ordinary tick — the query is one indexed anti-join and finds nothing, and
 * a gap it does find is claimed by a unique index so only the tick that found
 * it says anything.
 *
 * **Needs its migration applied first.** Missing `call_recording_gap` is this
 * throwing every five minutes.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sweepRecordingGaps();
  return NextResponse.json({ ok: true, job: "recordings", ...result });
}
