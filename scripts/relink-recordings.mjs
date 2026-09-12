// Reattach recordings whose call row lost its session id.
//
//   node --env-file=.env scripts/relink-recordings.mjs          # dry run
//   node --env-file=.env scripts/relink-recordings.mjs --apply
//
// A `call` row carries `telnyx_session_id` only when the outcome was logged
// while the line still knew it. Log it after hanging up — from the callbacks
// diary, or twenty minutes later — and the row is written without one, so the
// recording Telnyx already saved joins to nothing and the call has no "Listen
// back" and no transcript for ever. On 11 September a booked demo went that
// way: a real five-and-a-half-minute conversation with no recording against it.
//
// The provider now remembers the last finished call per lead, which stops new
// ones. This is the repair for everything already filed.
//
// **It matches on Telnyx's own `to`/`from`, never on time alone.** A recording
// is attached only when the number dialled is the lead's number and the number
// it was dialled from is the caller's own, and only when exactly one
// sessionless call fits. Anything ambiguous is reported and skipped: a
// recording bolted onto the wrong call is worse than an orphan, because an
// orphan is visibly missing and a wrong one is quietly believed.

import postgres from "postgres";

const API = "https://api.telnyx.com/v2";
const apply = process.argv.includes("--apply");

/** How far before the logged outcome a recording may have started. Generous
 *  because the whole failure being repaired is "logged late"; bounded because
 *  a lead rung twice in a day must not collapse into one match. */
const WINDOW_MS = 6 * 60 * 60_000;

/** Digits only, so +1 808 359 7807 and 8083597807 compare equal. */
const digits = (s) => String(s ?? "").replace(/\D/g, "");

if (!process.env.DATABASE_URL || !process.env.TELNYX_API_KEY) {
  console.error("DATABASE_URL and TELNYX_API_KEY must be set (--env-file=.env).");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

/** Telnyx's record for one recording: who it was to, and from which line. */
async function recordingDetail(recordingId) {
  const res = await fetch(`${API}/recordings/${recordingId}`, {
    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
  });
  if (!res.ok) return null;
  const d = (await res.json()).data ?? {};
  return { to: d.to ?? null, from: d.from ?? null };
}

// Orphans: a recording no call and no keypad dial points at. Keypad rows are
// excluded rather than repaired — they are a different table with no lead, and
// a keypad dial has no outcome to hang a recording off anyway.
const orphans = await sql`
  select r.recording_id, r.call_session_id, r.started_at, r.duration_ms
  from call_recording r
  where not exists (
      select 1 from "call" c where c.telnyx_session_id = r.call_session_id)
    and not exists (
      select 1 from keypad_call k where k.telnyx_session_id = r.call_session_id)
  order by r.started_at desc
`;

console.log(`${orphans.length} unlinked recording(s).\n`);

let linked = 0;
let noMatch = 0;
let ambiguous = 0;
let unknown = 0;

for (const rec of orphans) {
  const detail = await recordingDetail(rec.recording_id);
  if (!detail?.to || !detail?.from) {
    unknown += 1;
    continue;
  }

  // Sessionless calls to that number, placed by whoever holds the line it was
  // dialled from, around the time the recording started. The caller check is
  // what stops two people working the same niche being confused for each other.
  const candidates = await sql`
    select c.id, c.called_at, c.outcome, u.name as caller, l.company
    from "call" c
    join call_lead l on l.id = c.call_lead_id
    join app_user u on u.id = c.user_id
    where c.telnyx_session_id is null
      and regexp_replace(l.phone, '\\D', '', 'g') like ${"%" + digits(detail.to).slice(-10)}
      and regexp_replace(coalesce(u.telnyx_did, ''), '\\D', '', 'g') = ${digits(detail.from)}
      and c.called_at between ${new Date(new Date(rec.started_at).getTime() - 60_000)}
        and ${new Date(new Date(rec.started_at).getTime() + WINDOW_MS)}
    order by c.called_at asc
  `;

  const when = new Date(rec.started_at).toISOString().slice(0, 16).replace("T", " ");
  const secs = Math.round((rec.duration_ms ?? 0) / 1000);

  if (candidates.length === 0) {
    noMatch += 1;
    console.log(`  no match   ${when} ${String(secs).padStart(4)}s -> ${detail.to}`);
    continue;
  }
  if (candidates.length > 1) {
    ambiguous += 1;
    console.log(
      `  ambiguous  ${when} ${String(secs).padStart(4)}s -> ${detail.to} (${candidates.length} calls fit)`,
    );
    continue;
  }

  const c = candidates[0];
  console.log(
    `  ${apply ? "linked   " : "would link"} ${when} ${String(secs).padStart(4)}s -> ` +
      `${(c.company ?? "").slice(0, 28)} (${c.caller}, ${c.outcome})`,
  );
  if (apply) {
    // Guarded on still being null, so a concurrent write wins rather than
    // being overwritten by this.
    await sql`
      update "call" set telnyx_session_id = ${rec.call_session_id}
      where id = ${c.id} and telnyx_session_id is null
    `;
  }
  linked += 1;
}

console.log(
  `\n${apply ? "Linked" : "Would link"} ${linked}; ${noMatch} with no matching call, ` +
    `${ambiguous} ambiguous, ${unknown} Telnyx could not describe.`,
);
if (!apply && linked > 0) console.log("Re-run with --apply to write them.");

await sql.end();
