// Put the departed callers' calls back, with nobody's name on them.
//
//   node --env-file=.env scripts/restore-departed-calls.mjs <dump.sql>          # dry run
//   node --env-file=.env scripts/restore-departed-calls.mjs <dump.sql> --apply
//
// `wipe-departed.mjs` deletes the accounts AND their calls. That is too much
// when what was wanted is "keep the outcome, lose the name": a lead's state is
// derived from its most recent call, so deleting the calls sent 398 worked
// businesses back to "never called" and straight into the dial queue, where
// somebody would ring them a second time to be told no again.
//
// This reads a pre-wipe pg_dump and restores exactly those rows with
// `user_id` set to NULL — which is a state the app already has a word for.
// Calls made before staff accounts existed carry it, and Stats renders them as
// "Not attributed"; nothing needed teaching.
//
// The accounts stay deleted. Only the record of the work comes back.

import fs from "node:fs";
import postgres from "postgres";

const dumpPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dumpPath || !fs.existsSync(dumpPath)) {
  console.error("Usage: restore-departed-calls.mjs <dump.sql> [--apply]");
  process.exit(1);
}

/**
 * One table's rows out of a plain pg_dump.
 *
 * COPY text format: tab-separated, `\N` for null, one row per line with real
 * newlines inside a value escaped as `\n` — so a notes field spanning lines
 * cannot break the parse.
 */
function copyBlock(text, table) {
  const start = text.indexOf(`COPY public.${table} (`);
  if (start === -1) return { columns: [], rows: [] };
  const headerEnd = text.indexOf("\n", start);
  const header = text.slice(start, headerEnd);
  const columns = header
    .slice(header.indexOf("(") + 1, header.lastIndexOf(")"))
    .split(",")
    .map((c) => c.trim());
  const end = text.indexOf("\n\\.", headerEnd);
  const body = text.slice(headerEnd + 1, end);
  const rows = body
    ? body.split("\n").filter(Boolean).map((line) => {
        const values = line.split("\t");
        return Object.fromEntries(
          columns.map((c, i) => [
            c,
            values[i] === "\\N"
              ? null
              : // Undo COPY's escaping, so what goes back in is what came out.
                values[i]
                  .replace(/\\n/g, "\n")
                  .replace(/\\t/g, "\t")
                  .replace(/\\r/g, "\r")
                  .replace(/\\\\/g, "\\"),
          ]),
        );
      })
    : [];
  return { columns, rows };
}

const dump = fs.readFileSync(dumpPath, "utf8");
const users = copyBlock(dump, "app_user");
const calls = copyBlock(dump, "call");
const recordings = copyBlock(dump, "call_recording");
const attendance = copyBlock(dump, "call_demo_attendance");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Whoever is in the dump but not in the database now is who was deleted.
const liveIds = new Set(
  (await sql`select id from app_user`).map((r) => String(r.id)),
);
const departed = users.rows.filter((u) => !liveIds.has(u.id));
console.log(
  `${departed.length} departed account(s): ${departed.map((u) => u.name).join(", ")}`,
);

const departedIds = new Set(departed.map((u) => u.id));
const theirCalls = calls.rows.filter((c) => departedIds.has(c.user_id));

// Only rows that are genuinely missing now. Re-running must be harmless.
const liveCallIds = new Set(
  (await sql`select id from "call"`).map((r) => String(r.id)),
);
const toRestore = theirCalls.filter((c) => !liveCallIds.has(c.id));

const sessions = new Set(
  toRestore.map((c) => c.telnyx_session_id).filter(Boolean),
);
const liveRecordingIds = new Set(
  (await sql`select recording_id from call_recording`).map((r) => r.recording_id),
);
const recsToRestore = recordings.rows.filter(
  (r) => sessions.has(r.call_session_id) && !liveRecordingIds.has(r.recording_id),
);

const restoredCallIds = new Set(toRestore.map((c) => c.id));
const liveAttendanceIds = new Set(
  (await sql`select id from call_demo_attendance`).map((r) => String(r.id)),
);
// Attendance cascaded off the deleted calls. `payout_id` is deliberately
// dropped: those payouts are gone and will not come back, and a row pointing
// at a payout that no longer exists would not insert anyway.
const attToRestore = attendance.rows.filter(
  (a) => restoredCallIds.has(a.call_id) && !liveAttendanceIds.has(a.id),
);

console.log(`\n  calls to restore        ${toRestore.length}`);
console.log(`  recordings to restore   ${recsToRestore.length}`);
console.log(`  attendance to restore   ${attToRestore.length}`);
console.log(
  `  leads regaining a state ${new Set(toRestore.map((c) => c.call_lead_id)).size}`,
);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write them.");
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  for (const c of toRestore) {
    await tx`
      insert into "call" (id, call_lead_id, outcome, notes, callback_at,
        called_at, user_id, telnyx_session_id, duration_seconds)
      values (${Number(c.id)}, ${Number(c.call_lead_id)}, ${c.outcome},
        ${c.notes}, ${c.callback_at}, ${c.called_at},
        -- The whole point: the work is on the record, the person is not.
        null,
        ${c.telnyx_session_id},
        ${c.duration_seconds === null ? null : Number(c.duration_seconds)})
      on conflict (id) do nothing`;
  }

  for (const r of recsToRestore) {
    await tx`
      insert into call_recording (id, recording_id, call_session_id, call_leg_id,
        duration_ms, started_at, ended_at, received_at, transcript_text,
        transcript_turns, transcribed_at)
      values (${Number(r.id)}, ${r.recording_id}, ${r.call_session_id},
        ${r.call_leg_id}, ${r.duration_ms === null ? null : Number(r.duration_ms)},
        ${r.started_at}, ${r.ended_at}, ${r.received_at}, ${r.transcript_text},
        ${r.transcript_turns}, ${r.transcribed_at})
      on conflict (recording_id) do nothing`;
  }

  for (const a of attToRestore) {
    await tx`
      insert into call_demo_attendance (id, call_id, call_lead_id, marked_at,
        marked_by_user_id, payout_id, status)
      values (${Number(a.id)}, ${Number(a.call_id)}, ${Number(a.call_lead_id)},
        ${a.marked_at}, null, null, ${a.status})
      on conflict (id) do nothing`;
  }

  // Restoring explicit ids leaves the sequences behind them, so the next insert
  // would collide. Push each past the highest id it now holds.
  for (const t of ["call", "call_recording", "call_demo_attendance"]) {
    await tx.unsafe(
      `select setval(pg_get_serial_sequence('${t}', 'id'),
        greatest((select coalesce(max(id), 1) from "${t}"), 1))`,
    );
  }
});

const [c] = await sql`select count(*) as n from "call"`;
const [u] = await sql`select count(*) as n from "call" where user_id is null`;
const [r] = await sql`select count(*) as n from call_recording`;
console.log(`\nDone. calls: ${c.n} (${u.n} unattributed) | recordings: ${r.n}`);
await sql.end();
