import { getCurrentUser } from "@/lib/session";
import { syncMeetings, type MeetingSyncResult } from "@/lib/meetings";

/**
 * Pull Cal.com now, because somebody asked.
 *
 * The worker already does this every five minutes, which is fine for a
 * meeting a day away and much too slow for the person who booked one thirty
 * seconds ago and is looking at a screen that does not show it. That wait is
 * the whole reason this exists.
 *
 * Open to any signed-in employee rather than admins only: the caller who just
 * booked the demo is exactly who wants it, and it reads a calendar we already
 * poll on a timer — pressing it can reveal nothing a five-minute wait would
 * not have.
 */

/**
 * Shortest gap between two real pulls, however many people press the button.
 *
 * A button that hits a third-party API is a button somebody will hold down.
 * Inside the window the press is answered honestly — the screen still
 * refreshes, and the caller sees whatever the last pull found — rather than
 * with an error, because "nothing has changed in the last ten seconds" is not
 * a failure worth showing anybody.
 *
 * Process-local, which is enough: this runs as a single PM2 process, and the
 * cost of being wrong after a restart is one extra pair of API calls.
 */
const MIN_GAP_MS = 10_000;

/** When the last pull *finished*. Measured from completion rather than from
 *  the start, because Cal.com can take ten seconds on a cold connection and a
 *  cooldown shorter than the request it is pacing does not pace anything. */
let lastSyncAt = 0;

/** The pull currently running, if any. Presses that land while one is in
 *  flight wait for it and report its result rather than starting a second —
 *  which is the real protection, since the window in which someone can press
 *  twice is exactly the window in which the first request is still going. */
let inFlight: Promise<MeetingSyncResult> | null = null;

export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (inFlight) {
    return Response.json({ ok: true, ...(await inFlight) });
  }

  if (Date.now() - lastSyncAt < MIN_GAP_MS) {
    return Response.json({ ok: true, throttled: true });
  }

  inFlight = syncMeetings().finally(() => {
    lastSyncAt = Date.now();
    inFlight = null;
  });

  return Response.json({ ok: true, ...(await inFlight) });
}
