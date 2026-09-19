// Attach recordings to the calls they belong to, where the session id went
// missing.
//
//   node --env-file=.env scripts/relink-recordings.mjs           # dry run
//   node --env-file=.env scripts/relink-recordings.mjs --apply
//   node --env-file=.env scripts/relink-recordings.mjs --days 30
//
// Why: a recording is joined to its call by `telnyx_session_id`, and an
// outcome saved after the browser forgot the finished call carries none. The
// audio is still in Telnyx and the row is still in `call_recording`; it simply
// belongs to nobody. Aaron's 4m53s call that booked Garbage Removal LLc is the
// one that prompted this — a demo on the calendar with no recording behind it.
//
// What counts as the same call, and all four have to hold:
//
//   * the recording is attached to no call at all;
//   * the call has no session of its own, so nothing is being overwritten;
//   * the caller's own number placed it — `from_number` is their `telnyx_did`,
//     which is what stops a recording being hung on somebody else's call to
//     the same business;
//   * the prospect's number matches the lead's, and the outcome was logged
//     from five minutes before the recording started to thirty after.
//
// Ambiguity is refused rather than guessed: a recording with two candidate
// calls, or a call with two candidate recordings, is left alone and printed.
// Getting this wrong puts one person's conversation on another person's row.

import postgres from "postgres";

const apply = process.argv.includes("--apply");
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 7;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const digits = (s) => String(s ?? "").replace(/[^0-9]/g, "");

const recordings = await sql`
  select cr.id, cr.recording_id, cr.call_session_id, cr.started_at,
         cr.duration_ms, cr.from_number, cr.to_number
  from call_recording cr
  where cr.started_at > now() - make_interval(days => ${DAYS}::int)
    and not exists (
      select 1 from call c where c.telnyx_session_id = cr.call_session_id
    )
  order by cr.started_at
`;

// Every call in the window that lost its session, with the lead's number and
// the caller's own line to check against.
const calls = await sql`
  select c.id, c.called_at, c.outcome::text as outcome, c.call_lead_id,
         l.phone as lead_phone, coalesce(l.company, l.name) as company,
         u.name as caller, u.telnyx_did
  from call c
  join call_lead l on l.id = c.call_lead_id
  left join app_user u on u.id = c.user_id
  where c.telnyx_session_id is null
    and c.called_at > now() - make_interval(days => ${DAYS + 1}::int)
`;

const WINDOW_BEFORE_MS = 5 * 60_000;
const WINDOW_AFTER_MS = 30 * 60_000;

const pairs = [];
const ambiguous = [];

for (const r of recordings) {
  const started = new Date(r.started_at).getTime();
  const to = digits(r.to_number);
  const from = digits(r.from_number);
  if (!to || !from) continue;

  const hits = calls.filter((c) => {
    if (digits(c.lead_phone) !== to) return false;
    if (digits(c.telnyx_did) !== from) return false;
    const at = new Date(c.called_at).getTime();
    return at >= started - WINDOW_BEFORE_MS && at <= started + WINDOW_AFTER_MS;
  });

  if (hits.length === 0) continue;
  if (hits.length > 1) {
    ambiguous.push({ r, hits });
    continue;
  }
  pairs.push({ r, call: hits[0] });
}

// A call can only hold one session, so several recordings claiming the same
// call have to be narrowed to one. **The longest wins**, which is the rule
// `meetingSelect` already uses to pick the cold call off a lead
// (`order by cr.duration_ms desc`): a redial that rang for six seconds is not
// the conversation, and the one worth listening back to is the long one.
//
// This is not the same as the ambiguity above and must not be refused like it.
// There the question is *which call* a recording belongs to, and guessing puts
// one person's conversation on another person's row. Here the call is certain
// and only the best of its own recordings is in question.
const byCall = new Map();
for (const p of pairs) {
  const list = byCall.get(p.call.id) ?? [];
  list.push(p);
  byCall.set(p.call.id, list);
}
const clean = [];
const alsoRan = [];
for (const [, list] of byCall) {
  if (list.length === 1) {
    clean.push(list[0]);
    continue;
  }
  list.sort((a, b) => Number(b.r.duration_ms ?? 0) - Number(a.r.duration_ms ?? 0));
  clean.push(list[0]);
  alsoRan.push(...list.slice(1).map((l) => ({ call: list[0].call, r: l.r })));
}

clean.sort((a, b) => new Date(a.r.started_at) - new Date(b.r.started_at));

const secs = (ms) => Math.round(Number(ms ?? 0) / 1000);
console.log(
  `${recordings.length} unattached recordings in ${DAYS} days, ${clean.length} match exactly one call\n`,
);
for (const { r, call } of clean) {
  console.log(
    `  call ${String(call.id).padEnd(5)} ${String(call.caller ?? "?").padEnd(10)} ${call.outcome.padEnd(14)} ` +
      `${new Date(call.called_at).toISOString().slice(11, 19)}  ->  rec ${String(secs(r.duration_ms)).padStart(4)}s at ` +
      `${new Date(r.started_at).toISOString().slice(11, 19)}  ${String(call.company ?? "").slice(0, 32)}`,
  );
}
if (alsoRan.length) {
  console.log(`\n${alsoRan.length} shorter recording(s) of the same calls, left unattached:`);
  for (const a of alsoRan) {
    console.log(`  ${secs(a.r.duration_ms)}s at ${new Date(a.r.started_at).toISOString().slice(11, 19)} (call ${a.call.id})`);
  }
}
if (ambiguous.length) {
  console.log(`\n${ambiguous.length} left alone as ambiguous:`);
  for (const a of ambiguous) {
    const ids = Array.isArray(a.r) ? a.r.map((x) => x.id).join(",") : a.r.id;
    console.log(`  recording(s) ${ids} <-> calls ${a.hits.map((h) => h.id).join(",")}`);
  }
}

if (!apply) {
  console.log("\nDry run. Pass --apply to write.");
  await sql.end();
  process.exit(0);
}

let written = 0;
for (const { r, call } of clean) {
  // Guarded again at write time: another run, or the worker, may have filled
  // it in since the read above.
  const [row] = await sql`
    update call set telnyx_session_id = ${r.call_session_id}
    where id = ${call.id} and telnyx_session_id is null
    returning id`;
  if (row) written += 1;
}
console.log(`\nLinked ${written} of ${clean.length}.`);
await sql.end();
