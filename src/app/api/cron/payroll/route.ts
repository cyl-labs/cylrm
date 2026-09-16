import { NextResponse } from "next/server";
import { sendPayrollReminder } from "@/lib/payroll-reminder";

/**
 * The payday reminder.
 *
 * Its own job rather than a passenger on the quota tick, so the two read apart
 * in the worker log and one going wrong cannot take the other with it — the
 * reasoning every other digest here follows. They do land the same evening,
 * which is why they carry different notification tags.
 *
 * It runs on every five-minute tick and does nothing on all but a handful:
 * before the configured hour it returns immediately, and after it the week is
 * claimed by a unique index, so the next tick finds nothing to send.
 *
 * **Needs its migration applied first.** With push configured — which it is in
 * prod — the "nothing to do" branch is not taken, so missing columns or a
 * missing `payroll_reminder_sent` is this throwing every five minutes.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sendPayrollReminder();
  return NextResponse.json({ ok: true, job: "payroll", ...result });
}
