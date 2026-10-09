import { getCurrentUser } from "@/lib/session";

/**
 * One line in the server log whenever a browser phone loses or regains its
 * line (2026-10-08).
 *
 * Asked for because the phone's own console is invisible from here: Aaron and
 * Akshansh reported the header flashing between "Phone on" and "Phone not
 * connected", and nothing could say how often, why, or whether it was the
 * network, a second login or the line itself. This only writes to the log
 * (`pm2 logs crm | grep "\[phone\]"`); there is no table to keep.
 *
 * Signed-in users only, a fixed list of events, and short values, so it cannot
 * be used to fill the log with anything else.
 */
const EVENTS = new Set(["line_lost", "line_down", "registered", "gave_up"]);

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const event = typeof body?.event === "string" ? body.event : "";
  if (!EVENTS.has(event)) return Response.json({ error: "Unknown event." }, { status: 400 });
  const short = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 60) : "");
  console.log(
    `[phone] ${new Date().toISOString()} ${me.name} (${me.id}) ${event} why=${short(body?.why)} upFor=${short(body?.upForS)}s ` +
      `visible=${short(body?.visible)} tab=${short(body?.tab)} browser=${short(body?.browser)} online=${short(body?.online)} ` +
      `answers=${short(body?.answers)} ua=${short(body?.ua)}`,
  );
  return Response.json({ ok: true });
}
