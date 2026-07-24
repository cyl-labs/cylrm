import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Phase 4 implements the sending logic here (caps, pacing, window, tie-break).
  return NextResponse.json({
    ok: true,
    job: "scheduler",
    at: new Date().toISOString(),
  });
}
