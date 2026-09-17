import { NextResponse } from "next/server";
import {
  sendMeetingReminders,
  sendMeetingTelegrams,
  syncMeetings,
} from "@/lib/meetings";
import { sendMeetingDigest } from "@/lib/meeting-digest";

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
  // Telegram first: its half-hour warning is the one that cannot wait for
  // anything else on this tick to finish.
  const telegram = await sendMeetingTelegrams();
  const reminders = await sendMeetingReminders();
  // The morning list of what is coming up. A no-op on all but one tick a day,
  // claimed on the founders' own date.
  const digest = await sendMeetingDigest();
  return NextResponse.json({
    ok: true,
    job: "meetings",
    ...result,
    telegram,
    reminders,
    digest,
  });
}
