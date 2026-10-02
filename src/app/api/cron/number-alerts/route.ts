import { NextResponse } from "next/server";
import { sendNumberAlerts } from "@/lib/number-alerts";
import { hasCronAuth } from "@/lib/bearer";

/**
 * The five-minute check for numbers that have turned "probably flagged as spam",
 * which sends the founders a Telegram message once per number. See
 * `lib/number-alerts.ts`. Unset Telegram config means a quiet no-op.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!hasCronAuth(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const numbers = await sendNumberAlerts();
  return NextResponse.json({ ok: true, job: "number-alerts", numbers });
}
