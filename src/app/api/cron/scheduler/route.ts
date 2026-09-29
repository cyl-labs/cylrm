import { NextResponse } from "next/server";
import { runSchedulerTick } from "@/lib/scheduler";
import { hasCronAuth } from "@/lib/bearer";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!hasCronAuth(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerTick();
  return NextResponse.json({ ok: true, job: "scheduler", ...result });
}
