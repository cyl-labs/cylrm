import { NextResponse } from "next/server";
import { sendMeetingReminders, syncMeetings } from "@/lib/meetings";

/**
 * Pull the booked meetings off Cal.com.
 *
 * On the worker's existing five-minute loop alongside the scheduler and the
 * poller. Like `/api/cron/dnc` it is safe to deploy before its migration has
 * been applied and before Cal.com is configured — `syncMeetings` reports why
 * it did nothing rather than throwing, so a tick never fails on account of a
 * feature that is not switched on yet.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await syncMeetings();
  // After the sync, never before: a meeting cancelled ten minutes ago should
  // not be in the count somebody is pushed about.
  const reminders = await sendMeetingReminders();
  return NextResponse.json({ ok: true, job: "meetings", ...result, reminders });
}
