// Standalone 5-minute tick loop, kept alive by PM2.
// Run with: node --env-file=.env worker/index.mjs
const BASE = process.env.APP_URL ?? "http://localhost:3005";
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MS = 5 * 60 * 1000;

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
}

run();
setInterval(run, INTERVAL_MS);
