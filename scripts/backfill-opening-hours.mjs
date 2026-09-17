// Parse the opening hours of leads imported before the importer did.
//
//   node --env-file=.env scripts/backfill-opening-hours.mjs            # dry run
//   node --env-file=.env scripts/backfill-opening-hours.mjs --apply
//   node --env-file=.env scripts/backfill-opening-hours.mjs --apply --all
//
// Fills `call_lead.opening_hours` from the scrape's own columns in
// `source_fields`, with the same parser the importer uses. Only leads still
// null by default, so a re-run is harmless; `--all` re-parses every lead that
// carries hours, for after the parser has been taught something new.
//
// Needs `2026-09-17-opening-hours.sql` applied and the code shipped, since it
// imports the parser from `src/lib`.
//
// Written through the raw postgres client, so the week is bound with
// `sql.json`: this driver JSON-encodes a string parameter bound to a jsonb
// target, and `JSON.stringify(week)::jsonb` would store a jsonb *string* that
// every reader then takes for "no hours" (see Gotchas in AGENTS.md). Checked
// with `jsonb_typeof` at the end regardless.

import postgres from "postgres";
import { openingHoursFromScrape } from "../src/lib/opening-hours.mjs";

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const rows = await sql`
  select l.id,
    (select jsonb_object_agg(e.key, e.value)
       from jsonb_each(l.source_fields) e
      where e.key like 'openingHours/%') as fields
  from call_lead l
  where l.source_fields ? 'openingHours/0/day'
    ${all ? sql`` : sql`and l.opening_hours is null`}`;

const updates = [];
let unreadable = 0;
for (const r of rows) {
  const week = openingHoursFromScrape(r.fields);
  if (week) updates.push({ id: r.id, week });
  else unreadable++;
}
console.log(
  `${rows.length} leads with a scraped week${all ? "" : " and no hours yet"}: ` +
    `${updates.length} parsed, ${unreadable} left on the default window`,
);

if (!apply) {
  console.log("Dry run. Re-run with --apply to write them.");
  await sql.end();
  process.exit(0);
}

if (updates.length > 0) {
  const [done] = await sql`
    with v as (
      select * from jsonb_to_recordset(${sql.json(updates)}) as x(id int, week jsonb)
    ),
    u as (
      update call_lead l set opening_hours = v.week
      from v where l.id = v.id
      returning 1
    )
    select count(*)::int as n from u`;
  console.log(`Wrote ${done.n}.`);
}

const [check] = await sql`
  select
    count(*) filter (where jsonb_typeof(opening_hours) = 'object')::int as objects,
    count(*) filter (where opening_hours is not null
                       and jsonb_typeof(opening_hours) <> 'object')::int as wrong
  from call_lead`;
console.log(`Stored weeks: ${check.objects} objects, ${check.wrong} of the wrong type.`);
await sql.end();
if (check.wrong > 0) process.exit(1);
