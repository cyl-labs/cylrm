import { NextResponse } from "next/server";
import { sendMeetingTelegrams } from "@/lib/meetings";

/**
 * The five-minute warning, on its own minute-by-minute tick.
 *
 * Split out of `/api/cron/meetings` on 2026-09-20, when the warning moved from
 * thirty minutes to five. That job runs every five minutes because it syncs
 * Cal.com, and a five-minute window checked every five minutes gives a warning
 * that lands anywhere between five minutes and a few seconds before the call:
 * exactly one tick falls inside the window, and nothing says where in it.
 *
 * So the alert runs on its own loop and the sync stays where it was. This is
 * one indexed query against `call_meeting` on all but a handful of ticks a
 * day, which is cheap in a way a Cal.com sync every minute would not be.
 *
 * It is deliberately *only* the Telegram alert. The push reminders, the digest
 * and the sync all still ride the five-minute job: none of them is sensitive
 * to a few minutes, and running the sync twice over would double the calls
 * to Cal.com for nothing.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const telegram = await sendMeetingTelegrams();
  return NextResponse.json({ ok: true, job: "meeting-alerts", telegram });
}
