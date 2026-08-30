// Sync data/us-area-codes.json into `us_area_code`.
//
//   node --env-file=.env scripts/seed-area-codes.mjs
//
// Run on every deploy, like seed-sop.mjs. The JSON file is the source of
// truth and this table is its index — the table exists only because the
// dialler queue selects with a LIMIT, so "is it business hours where this
// lead is" has to be answerable inside the query rather than after it.
//
// Upserts, and deletes any code no longer in the file, so the two cannot
// drift. New area codes appear every year or so; edit the JSON and deploy.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env).");
  process.exit(1);
}

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "us-area-codes.json",
);

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const map = JSON.parse(await readFile(file, "utf8"));
  const entries = Object.entries(map);
  if (entries.length === 0) throw new Error("area code map is empty");

  for (const [code, tz] of entries) {
    if (!/^[2-9][0-9]{2}$/.test(code)) {
      throw new Error(`not an area code: ${code}`);
    }
    if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(tz)) {
      throw new Error(`not an IANA zone: ${tz}`);
    }
  }

  await sql`
    insert into us_area_code ${sql(
      entries.map(([area_code, tz]) => ({ area_code, tz })),
      "area_code",
      "tz",
    )}
    on conflict (area_code) do update set tz = excluded.tz
  `;

  const codes = entries.map(([c]) => c);
  const removed = await sql`
    delete from us_area_code where area_code <> all(${codes}) returning area_code
  `;

  console.log(
    `Area codes: ${entries.length} published` +
      (removed.length ? `, ${removed.length} removed` : ""),
  );
} catch (err) {
  console.error("Seeding area codes failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
