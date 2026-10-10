import { NextResponse } from "next/server";
import { sendDemoTextReminders } from "@/lib/demo-text-reminder";
import { hasCronAuth } from "@/lib/bearer";

/**
 * The reminder text to a prospect, about an hour before their demo.
 *
 * Its own job so the worker log shows it apart from the Cal.com sync. Does
 * nothing unless `DEMO_TEXT_REMINDERS=1`; see lib/demo-text-reminder.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!hasCronAuth(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sendDemoTextReminders();
  return NextResponse.json({ ok: true, job: "demo-texts", ...result });
}
