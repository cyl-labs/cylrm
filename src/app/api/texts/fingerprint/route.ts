import { getCurrentUser } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { textsFingerprint } from "@/lib/texts";

/**
 * Whether anything on the Texts screen has changed, without rendering it.
 *
 * Asked every ten seconds by an open Texts tab, which used to refresh the
 * whole page on that timer. See `textsFingerprint`.
 */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!smsEnabled()) return Response.json({ fingerprint: "off" });
  return Response.json(
    { fingerprint: await textsFingerprint(me) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
