import { NextResponse } from "next/server";
import { runSchedulerTick } from "@/lib/scheduler";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerTick();
  return NextResponse.json({ ok: true, job: "scheduler", ...result });
}
