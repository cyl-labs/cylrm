import { NextResponse } from "next/server";
import { sendCallbackReminders } from "@/lib/callback-reminders";

/**
 * The daily callbacks digest.
 *
 * Its own job rather than a passenger on the meetings tick, so the two can be
 * read apart in the worker log and one going wrong cannot take the other with
 * it. Safe to deploy before its migration and before push is configured — it
 * reports why it did nothing rather than throwing.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sendCallbackReminders();
  return NextResponse.json({ ok: true, job: "callbacks", ...result });
}
