import { NextResponse } from "next/server";
import { syncTopUps } from "@/lib/elevenlabs";
import { hasCronAuth } from "@/lib/bearer";

/** Spots ElevenLabs top-ups by the credit limit rising and logs them. */
export async function POST(request: Request) {
  if (!hasCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, job: "elevenlabs", ...(await syncTopUps()) });
  } catch (err) {
    console.error("elevenlabs sync failed:", err);
    return NextResponse.json({ ok: false, job: "elevenlabs" }, { status: 500 });
  }
}
