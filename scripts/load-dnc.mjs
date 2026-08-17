// Load a downloaded FTC Do Not Call area-code file into `dnc_number`.
//
//   node --env-file=.env scripts/load-dnc.mjs 415 ~/Downloads/415.txt
//
// The FTC distributes the register rather than answering queries, and the first
// five area codes are free each year with a SAN from telemarketing.donotcall.gov.
// So screening is a set membership test against a table we own — no per-number
// cost, no rate limit, no third party.
//
// One area code per run, replaced wholesale: a partial refresh would leave
// numbers behind that have since been removed from the register, and screening
// someone out who has taken themselves off it is its own kind of wrong.
//
// The file is read as a stream. An area code can hold millions of numbers, and
// reading that into a string first is how this falls over on the droplet.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import postgres from "postgres";

const [, , areaCodeArg, file] = process.argv;

if (!areaCodeArg || !file) {
  console.error("usage: node scripts/load-dnc.mjs <area-code> <file>");
  process.exit(1);
}
if (!/^\d{3}$/.test(areaCodeArg)) {
  console.error(`"${areaCodeArg}" is not a three-digit area code.`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env).");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const CHUNK = 5000;
/** Mirrors DNC_VALID_DAYS in src/lib/dnc.ts — the TSR safe-harbour window. */
const DNC_DAYS = 31;

let batch = [];
let loaded = 0;
let skipped = 0;

async function flush() {
  if (batch.length === 0) return;
  await sql`
    insert into dnc_number ${sql(batch, "number", "area_code")}
    on conflict (number) do nothing
  `;
  loaded += batch.length;
  batch = [];
}

try {
  // Wholesale replacement, in one transaction with the stamp, so a crash
  // half-way cannot leave a half-loaded area code looking freshly screened.
  await sql.begin(async (tx) => {
    await tx`delete from dnc_number where area_code = ${areaCodeArg}`;
  });

  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // The files are one number per line, but a CSV export puts it first.
    const digits = line.split(",")[0].replace(/\D/g, "");
    if (digits.length !== 10 || !digits.startsWith(areaCodeArg)) {
      if (digits.length > 0) skipped++;
      continue;
    }
    batch.push({ number: digits, area_code: areaCodeArg });
    if (batch.length >= CHUNK) await flush();
  }
  await flush();

  // Counted from the table, not from the lines pushed: a file with the same
  // number twice inserts once, and a count that disagrees with the register is
  // the sort of thing nobody checks until it matters.
  const [{ count }] = await sql`
    select count(*)::int as count from dnc_number where area_code = ${areaCodeArg}
  `;

  await sql`
    insert into dnc_area_code (area_code, loaded_at, number_count)
    values (${areaCodeArg}, now(), ${count})
    on conflict (area_code)
      do update set loaded_at = now(), number_count = ${count}
  `;

  const dupes = loaded - count;
  console.log(
    `Loaded ${count.toLocaleString()} numbers for area code ${areaCodeArg}` +
      (dupes ? ` (${dupes.toLocaleString()} duplicate lines)` : "") +
      (skipped ? ` (${skipped.toLocaleString()} lines skipped)` : "") +
      `.\nRe-download before ${DNC_DAYS} days pass or every lead in it blocks.`,
  );
} finally {
  await sql.end();
}
