// Export the SOP markdown as printable handouts.
//
//   node scripts/export-sop.mjs                 # every caller-facing document
//   node scripts/export-sop.mjs script-us objections-us
//
// Writes standalone HTML into handouts/. Open one in Chrome and print to PDF:
// the print stylesheet is what the page is designed around, so what comes out
// matches the screen.
//
// This exists because the PDFs were a hand-made copy of these files, and a
// hand-made copy of a document that changes weekly is a document that is wrong
// within a fortnight. The price moved from $79 to $99, the objection sheet
// grew from twelve entries to twenty and was regrouped into families, and the
// booking half of the script was rewritten around time zones -- none of which
// reached the PDFs. Now they are generated, so "the handouts are outdated" is
// one command rather than an afternoon.
//
// It deliberately writes no PDF itself. The CRM does that — Founders get an
// "Export as PDF" button on each document, which posts this same HTML to the
// Gotenberg already running on the droplet. This stays the offline route, and
// the one that works from a laptop with no server at all.
//
// The rendering itself lives in src/lib/handout.mjs so the two cannot drift.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHandoutDoc, render } from "../src/lib/handout.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "content", "sop");
const out = path.join(root, "handouts");

const wanted = process.argv.slice(2);

const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
const docs = await Promise.all(
  files.map(async (f) =>
    parseHandoutDoc(await readFile(path.join(dir, f), "utf8"), f.replace(/\.md$/, "")),
  ),
);

await mkdir(out, { recursive: true });

let written = 0;
for (const doc of docs) {
  if (wanted.length > 0 && !wanted.includes(doc.slug)) continue;
  // Never exported, even when named explicitly. These handouts go to people
  // outside the company — an interviewee has no account and no NDA — and
  // `audience: admins` is on the demo call, the ROI maths and the commercial
  // terms. Refusing loudly rather than skipping quietly, since somebody who
  // asked for it by name is expecting a file.
  if (doc.adminOnly) {
    if (wanted.includes(doc.slug)) {
      console.error(`REFUSED ${doc.slug}: founders-only (audience: admins).`);
      process.exitCode = 1;
    }
    continue;
  }
  const file = path.join(out, `${doc.slug}.html`);
  await writeFile(file, render(doc), "utf8");
  console.log(`wrote handouts/${doc.slug}.html  (${doc.title})`);
  written += 1;
}

if (written === 0) {
  console.error("Nothing exported. Known slugs:", docs.map((d) => d.slug).join(", "));
  process.exitCode = 1;
}
