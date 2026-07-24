import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Phase 5 implements inbox polling + reply/bounce/auto-reply classification here.
  return NextResponse.json({
    ok: true,
    job: "poller",
    at: new Date().toISOString(),
  });
}
