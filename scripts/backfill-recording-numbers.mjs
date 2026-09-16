/**
 * Fill in `call_recording.to_number` / `from_number` from the Telnyx API.
 *
 *   node --env-file=.env scripts/backfill-recording-numbers.mjs [--write]
 *
 * Dry by default: it reports what it would change and writes nothing. Pass
 * `--write` to apply.
 *
 * WHY THIS EXISTS. A `call` row is written when somebody logs an outcome and a
 * `keypad_call` row when a leg ends, so a prospect dialled and talked to
 * without an outcome being tapped leaves audio that no row points at — which is
 * every demo call, because at demo time a founder is talking rather than
 * tapping. 122 recordings were in that state on 2026-09-17: 111 minutes of
 * conversation, reachable from nowhere in the app.
 *
 * `call_recording` stored only ids, so there was no way to ask which business a
 * recording was of. Telnyx knows — every record on `GET /v2/recordings` carries
 * `to` and `from` — and the webhook now stores them going forward. This fills in
 * the history.
 *
 * Idempotent: it only writes where the column is still null, so a second run is
 * a no-op, and it never overwrites what the webhook stored.
 *
 * Written against the raw postgres client, which is the shape of script that
 * produced the double-encoded jsonb documented in
 * `2026-09-16-transcript-turns-unwrap.sql`. Nothing here writes jsonb — these
 * are two text columns — so that trap does not apply, but it is worth knowing
 * before anybody extends this.
 */
import postgres from "postgres";

const WRITE = process.argv.includes("--write");
const KEY = process.env.TELNYX_API_KEY;
if (!KEY) {
  console.error("TELNYX_API_KEY is not set — nothing to read from.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

/** Every recording Telnyx still has, keyed by its id. The window is the API's,
 *  not ours: anything aged out simply cannot be filled in, and the report says
 *  how many. */
async function fetchAll() {
  const byId = new Map();
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(
      `https://api.telnyx.com/v2/recordings?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`,
      { headers: { Authorization: `Bearer ${KEY}` } },
    );
    const body = await res.json().catch(() => ({}));
    if (body.errors) {
      throw new Error(`Telnyx: ${JSON.stringify(body.errors).slice(0, 200)}`);
    }
    const rows = body.data ?? [];
    for (const r of rows) if (r.id) byId.set(String(r.id), r);
    if (rows.length < 100) break;
  }
  return byId;
}

const api = await fetchAll();
console.log(`Telnyx returned ${api.size} recordings.`);

const rows = await sql`
  select recording_id, call_session_id, started_at
  from call_recording
  where to_number is null and from_number is null
  order by id`;
console.log(`${rows.length} rows in the CRM have no numbers stored.`);

let filled = 0;
let missing = 0;
const preview = [];
for (const row of rows) {
  const found = api.get(String(row.recording_id));
  if (!found || (!found.to && !found.from)) {
    missing += 1;
    continue;
  }
  filled += 1;
  if (preview.length < 10) {
    preview.push(
      `  ${String(found.from ?? "?")} -> ${String(found.to ?? "?")}  ${
        row.started_at ? new Date(row.started_at).toISOString().slice(0, 16) : "?"
      }`,
    );
  }
  if (WRITE) {
    // Guarded on null again in the statement, not just in the read above: the
    // webhook may have stored numbers for this row between the two.
    await sql`
      update call_recording
      set to_number = coalesce(to_number, ${found.to ?? null}),
          from_number = coalesce(from_number, ${found.from ?? null})
      where recording_id = ${row.recording_id}`;
  }
}

console.log("");
console.log(`  ${filled} ${WRITE ? "filled in" : "would be filled in"}`);
console.log(`  ${missing} not in the API window, so they stay blank`);
if (preview.length) {
  console.log("\n  a sample of what was matched:");
  for (const line of preview) console.log(line);
}
if (!WRITE) console.log("\nDry run. Re-run with --write to apply.");

await sql.end();
