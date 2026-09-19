// Delete departed staff and everything hanging off them.
//
//   node --env-file=.env scripts/wipe-departed.mjs            # dry run
//   node --env-file=.env scripts/wipe-departed.mjs --apply
//
// One-off, and deliberately not a button anywhere: deactivating is the reversible
// gesture the Team screen offers, and this is the irreversible one. Take a dump
// first — `docker exec cylrm-db pg_dump -U cylrm -d cylrm > …`.
//
// **Deleting a caller's calls returns their leads to "never called".** A lead's
// state is derived from its most recent call, so every business whose last call
// was one of theirs re-enters the dial queue and will be rung again by somebody
// else. That is the real cost of this, not the disk space; the count is printed
// before anything is written.
//
// Order matters. Everything that points at a call or a user is cleared first,
// because most of those foreign keys are NO ACTION and would simply refuse.
// Rows that belong to the *business* rather than to the person — an inbound
// call, a meeting, a contract — keep existing and lose the name instead.

import postgres from "postgres";

const apply = process.argv.includes("--apply");
const USERNAMES = [
  "alex", "kelly", "victoria", "walli", "maxi", "samson",
  "allie", "ghazl", "mae", "resetop", "ellie", "shifu",
];

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const people = await sql`
  select id, name, username, active from app_user where username = any(${USERNAMES})`;
const ids = people.map((p) => p.id);

const missing = USERNAMES.filter((u) => !people.some((p) => p.username === u));
if (missing.length) console.log("not found (already gone):", missing.join(", "));
console.log(`${people.length} account(s): ${people.map((p) => p.name).join(", ")}\n`);

/**
 * Is a column nullable? Decides whether a row that belongs to the business can
 * keep existing with the name cleared, or has to go with the person.
 *
 * **Resolved before the transaction opens, never inside it.** The pool is one
 * connection, so a lookup on the outer handle while `sql.begin` holds it waits
 * for a connection that the waiting itself is preventing from being released:
 * the transaction goes "idle in transaction" holding locks until somebody
 * terminates the backend. Done once, up front, into a plain object.
 */
async function nullable(table, column) {
  const [r] = await sql`
    select is_nullable from information_schema.columns
    where table_name = ${table} and column_name = ${column}`;
  return r?.is_nullable === "YES";
}

const counts = {};
const n = async (label, rows) => {
  counts[label] = Number(rows[0]?.n ?? 0);
  return counts[label];
};

await n("calls", await sql`select count(*) as n from "call" where user_id = any(${ids})`);
await n("recordings", await sql`
  select count(*) as n from call_recording r
  where exists (select 1 from "call" c
    where c.telnyx_session_id = r.call_session_id and c.user_id = any(${ids}))`);
await n("leads returned to the queue", await sql`
  select count(*) as n from call_lead l
  where exists (select 1 from "call" c where c.call_lead_id = l.id)
    and (select c.user_id from "call" c where c.call_lead_id = l.id
         order by c.called_at desc, c.id desc limit 1) = any(${ids})`);
await n("lists to unassign", await sql`
  select count(*) as n from call_list where assigned_user_id = any(${ids})`);
await n("payouts", await sql`
  select count(*) as n from payout where user_id = any(${ids}) or created_by_user_id = any(${ids})`);
await n("keypad dials", await sql`select count(*) as n from keypad_call where user_id = any(${ids})`);
await n("meeting follow-ups", await sql`
  select count(*) as n from call_meeting_followup where user_id = any(${ids})`);
await n("contracts drafted", await sql`
  select count(*) as n from call_contract where user_id = any(${ids})`);
await n("inbound calls handled", await sql`
  select count(*) as n from inbound_call where user_id = any(${ids}) or handled_by = any(${ids})`);
await n("attendance they marked", await sql`
  select count(*) as n from call_demo_attendance where marked_by_user_id = any(${ids})`);

for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(28)} ${v}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  await sql.end();
  process.exit(0);
}

const CAN_NULL = {
  attendanceMarkedBy: await nullable("call_demo_attendance", "marked_by_user_id"),
  inboundUser: await nullable("inbound_call", "user_id"),
  inboundHandledBy: await nullable("inbound_call", "handled_by"),
  contractUser: await nullable("call_contract", "user_id"),
};

await sql.begin(async (tx) => {
  // 1. Niches go back to nobody rather than away: the leads are the asset and
  //    an unassigned list is reassignable from the Call lists screen.
  await tx`update call_list set assigned_user_id = null where assigned_user_id = any(${ids})`;

  // 2. Recordings of their calls. No foreign key ties these to `call` — they
  //    join on the Telnyx session id — so nothing would clean them up, and a
  //    recording nothing points at is unreachable dead weight.
  await tx`delete from call_recording r
    where exists (select 1 from "call" c
      where c.telnyx_session_id = r.call_session_id and c.user_id = any(${ids}))`;

  // 3. Rows that are theirs outright.
  await tx`delete from call_meeting_followup where user_id = any(${ids})`;
  await tx`delete from keypad_call where user_id = any(${ids})`;
  await tx`delete from payout where user_id = any(${ids}) or created_by_user_id = any(${ids})`;

  // 4. Rows that belong to the business and merely carry a name. Cleared where
  //    the column allows it so the record survives the person.
  if (CAN_NULL.attendanceMarkedBy) {
    await tx`update call_demo_attendance set marked_by_user_id = null
      where marked_by_user_id = any(${ids})`;
  } else {
    await tx`delete from call_demo_attendance where marked_by_user_id = any(${ids})`;
  }
  if (CAN_NULL.inboundUser) {
    await tx`update inbound_call set user_id = null where user_id = any(${ids})`;
  }
  if (CAN_NULL.inboundHandledBy) {
    await tx`update inbound_call set handled_by = null where handled_by = any(${ids})`;
  }
  if (CAN_NULL.contractUser) {
    await tx`update call_contract set user_id = null where user_id = any(${ids})`;
  } else {
    await tx`delete from call_contract where user_id = any(${ids})`;
  }

  // 5. The calls. Attendance on them cascades; a meeting that pointed at one
  //    keeps its row and loses the link, which is right — the booking happened.
  await tx`delete from "call" where user_id = any(${ids})`;

  // 6. The accounts. Push subscriptions and callback reminders cascade.
  await tx`delete from app_user where id = any(${ids})`;
});

const [left] = await sql`
  select count(*) as n from app_user where username = any(${USERNAMES})`;
const [orphanLists] = await sql`
  select count(*) as n from call_list where assigned_user_id is null`;
console.log(`\nDone. ${left.n} of those accounts remain; ${orphanLists.n} lists now unassigned.`);
await sql.end();
