// Standalone 5-minute tick loop, kept alive by PM2.
// Run with: node --env-file=.env worker/index.mjs
const BASE = process.env.APP_URL ?? "http://localhost:3005";
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MS = 5 * 60 * 1000;
/**
 * The meeting warning runs on its own, every minute.
 *
 * It is five minutes before the call now rather than thirty, and a five-minute
 * window checked every five minutes gives anywhere from five minutes' notice
 * to a few seconds — one tick always lands in the window, nothing says where.
 * A minute's granularity makes "five minutes" mean four or five.
 *
 * Only the Telegram alert, not the whole meetings job: that one syncs Cal.com
 * and would be five times the API calls for no benefit.
 */
const ALERT_INTERVAL_MS = 60 * 1000;

if (!SECRET) {
  console.error("CRON_SECRET is not set; refusing to start");
  process.exit(1);
}

async function tick(job) {
  try {
    const res = await fetch(`${BASE}/api/cron/${job}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const body = await res.text();
    console.log(new Date().toISOString(), job, res.status, body);
  } catch (err) {
    console.error(new Date().toISOString(), job, "failed:", err.message);
  }
}

async function run() {
  await tick("scheduler");
  await tick("poller");
  // Cheap to run this often even though results last 31 days: a lead that has
  // just been screened is not selected again, so the job finds nothing on all
  // but a handful of ticks. It is capped per tick because every check is paid
  // for by the number.
  await tick("dnc");
  // Cal.com is the calendar of record for booked demos and nothing pushed
  // that back to us. Two API calls a tick, and it is what puts a meeting on
  // the Meetings diary and takes a cancelled one off it. The five-minute
  // warning it used to carry is on `alerts()` below, once a minute.
  await tick("meetings");
  // One digest a day per person, claimed by a unique index — the other 287
  // ticks find nothing to do.
  await tick("callbacks");
  // The founders' end-of-week report on the 300-call quota. Returns
  // immediately outside Friday evening to Sunday, and the week is claimed by a
  // unique index inside it, so this is a no-op on all but one tick a week.
  await tick("quota");
  // Payday. Settable, defaulting to Friday 5pm in the recipient's own zone,
  // and claimed per pay week — so like the two above this is a no-op on all
  // but one tick a week.
  await tick("payroll");
  // Calls that connected and never got a recording. Unlike the three digests
  // above this runs on every tick and reports the moment it finds something:
  // they describe a day that is over, this one describes a fault that may
  // still be running. Telnyx dropped 34 answered calls on 2026-09-21 and
  // nothing noticed for three days, because nothing was looking.
  await tick("recordings");
}

/**
 * Wait for the app to answer before the first run.
 *
 * A deploy restarts the app and this worker together, and the app takes a few
 * seconds to start listening. Firing straight away failed every job on every
 * deploy and left the next attempt five minutes out — five minutes a
 * 30-minute meeting warning could arrive late. Any response counts: this only
 * asks whether something is listening.
 */
async function waitForApp() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/login`, { method: "HEAD" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Kept apart from `run` on purpose: that one is a queue of jobs awaited in
 * order, and a slow sync or a stuck poller must not be able to hold the
 * warning for somebody's demo behind it.
 */
async function alerts() {
  await tick("meeting-alerts");
}

await waitForApp();
run();
alerts();
setInterval(run, INTERVAL_MS);
setInterval(alerts, ALERT_INTERVAL_MS);
