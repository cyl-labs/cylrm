// Publish the markdown under content/sop/ into `sop_document`.
//
//   node --env-file=.env scripts/seed-sop.mjs
//
// Run on every deploy. Content is edited as files and versioned in git, which
// is why there is no editor in the app and no revision history in the table —
// git already is one, and a better one.
//
// Upserts on the file's slug, so re-running is safe and a rewritten document
// keeps its URL. A document whose file is deleted is removed too: otherwise a
// retired script would sit in the library forever with nothing pointing at it.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env).");
  process.exit(1);
}

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "content",
  "sop",
);

/** Front matter is three keys and nothing nested, so it is read directly
 *  rather than adding a YAML parser for it. */
function parse(raw, slug) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${slug}: missing front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!meta.kind) throw new Error(`${slug}: no kind`);
  if (!meta.title) throw new Error(`${slug}: no title`);
  if (!["script", "objections", "procedure"].includes(meta.kind)) {
    throw new Error(`${slug}: unknown kind "${meta.kind}"`);
  }
  const region = meta.region && meta.region !== "null" ? meta.region : null;
  if (region && !["sg", "us"].includes(region)) {
    throw new Error(`${slug}: unknown region "${region}"`);
  }
  return { slug, kind: meta.kind, region, title: meta.title, body: m[2].trim() };
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  const docs = await Promise.all(
    files.map(async (f) =>
      parse(await readFile(path.join(dir, f), "utf8"), f.replace(/\.md$/, "")),
    ),
  );

  for (const d of docs) {
    await sql`
      insert into sop_document (slug, kind, region, title, body_md, updated_at)
      values (${d.slug}, ${d.kind}, ${d.region}, ${d.title}, ${d.body}, now())
      on conflict (slug) do update set
        kind = excluded.kind,
        region = excluded.region,
        title = excluded.title,
        body_md = excluded.body_md,
        updated_at = now()
    `;
  }

  const slugs = docs.map((d) => d.slug);
  const removed = await sql`
    delete from sop_document where slug <> all(${slugs}) returning slug
  `;

  console.log(
    `Published ${docs.length} document(s): ${slugs.join(", ")}` +
      (removed.length
        ? `\nRemoved ${removed.length} whose file is gone: ${removed
            .map((r) => r.slug)
            .join(", ")}`
        : ""),
  );
} finally {
  await sql.end();
}
