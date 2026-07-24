import { NextResponse } from "next/server";
import { runPollerTick } from "@/lib/poller";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPollerTick();
  return NextResponse.json({ ok: true, job: "poller", ...result });
}
