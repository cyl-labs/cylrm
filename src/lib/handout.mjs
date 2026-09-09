// The printable handout: markdown in, standalone HTML out.
//
// Plain ESM rather than TypeScript so that both callers can have it without a
// build step — `scripts/export-sop.mjs` runs under bare node, and the CRM's
// `/api/sop/[slug]/pdf` route imports it to hand the same HTML to Gotenberg.
// One renderer, so the PDF a founder downloads from the app and the one
// generated on a laptop cannot drift into two different documents.

import { marked } from "marked";

/** The same three-key front matter the seeder reads, and the same refusal to
 *  guess: an unknown `audience` throws rather than being read as "everyone". */
export function parseHandoutDoc(raw, slug) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${slug}: missing front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!meta.title) throw new Error(`${slug}: no title`);
  if (meta.audience && meta.audience !== "admins") {
    throw new Error(`${slug}: unknown audience "${meta.audience}"`);
  }
  return {
    slug,
    title: meta.title,
    kind: meta.kind,
    region: meta.region && meta.region !== "null" ? meta.region : null,
    adminOnly: meta.audience === "admins",
    body: m[2].trim(),
  };
}

const md = (s) => marked.parse(s, { async: false });

/** Tag each blockquote by who is speaking, exactly as `SopProse` does: the
 *  label is the first <strong> inside the quote, so the match is on that shape
 *  rather than on text that may drift past it. */
const tagSpeakers = (html) =>
  html
    .replace(
      /<blockquote>\s*<p><strong>You say<\/strong>/g,
      '<blockquote data-speaker="you"><p><strong>You say</strong>',
    )
    .replace(
      /<blockquote>\s*<p><strong>Prospect<\/strong>/g,
      '<blockquote data-speaker="prospect"><p><strong>Prospect</strong>',
    );

const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `## ` splitting, the branch rule and the `Family | Title` split, all
 *  mirroring `toSections` in src/lib/sop.ts. If that changes, this changes:
 *  a handout that groups or numbers differently to the screen a caller works
 *  from is two documents claiming to be one. */
function toSections(body) {
  const parts = body.split(/^## /m);
  const intro = parts.shift() ?? "";
  const sections = parts.map((part) => {
    const at = part.indexOf("\n");
    const heading = (at === -1 ? part : part.slice(0, at)).trim();
    const bar = heading.indexOf(" | ");
    return {
      category: bar === -1 ? null : heading.slice(0, bar).trim(),
      title: bar === -1 ? heading : heading.slice(bar + 3).trim(),
      // A branch is taken only if it happens, so it earns no step number.
      branch: /^(if|only if|otherwise)\b/i.test(
        bar === -1 ? heading : heading.slice(bar + 3).trim(),
      ),
      body: at === -1 ? "" : part.slice(at + 1),
    };
  });
  return { intro: intro.trim(), sections };
}

const REGION_LABEL = { us: "US", sg: "Singapore" };

export function render(doc) {
  const { intro, sections } = toSections(doc.body);

  let step = 0;
  let lastCategory = null;
  const blocks = sections.map((s) => {
    const parts = [];
    if (s.category && s.category !== lastCategory) {
      lastCategory = s.category;
      parts.push(`<h2 class="family">${escape(s.category)}</h2>`);
    }
    const label = s.branch
      ? '<span class="num branch">&#8627;</span>'
      : `<span class="num">${String(++step).padStart(2, "0")}</span>`;
    parts.push(
      `<section class="${s.branch ? "step branch-step" : "step"}">`,
      `<h3>${label}<span class="title">${escape(s.title)}</span></h3>`,
      `<div class="body">${tagSpeakers(md(s.body))}</div>`,
      `</section>`,
    );
    return parts.join("\n");
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)}</title>
<style>
  :root { --ink:#141416; --muted:#6b6b73; --accent:#C0392B;
          --you:#FDE7E1; --them:#EDEDED; --rule:#dcdce1; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f6;
         font: 400 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         color: var(--ink); }
  .page { max-width: 820px; margin: 0 auto; background: #fff; padding: 56px 60px 72px; }

  header { display: flex; align-items: baseline; justify-content: space-between;
           gap: 24px; border-bottom: 3px solid var(--ink); padding-bottom: 14px; }
  h1 { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; margin: 0; }
  .tag { color: var(--accent); font-size: 11px; font-weight: 700;
         letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }

  .intro { margin: 22px 0 0; }
  .intro p, .intro li { color: var(--muted); }
  .intro strong { color: var(--ink); }
  .intro ul { padding-left: 20px; }

  h2.family { font-size: 12px; font-weight: 800; letter-spacing: 0.1em;
              text-transform: uppercase; color: var(--accent);
              margin: 40px 0 0; padding-bottom: 6px;
              border-bottom: 2px solid var(--ink); }

  .step { margin-top: 26px; page-break-inside: avoid; }
  .step h3 { display: flex; gap: 12px; align-items: baseline;
             font-size: 17px; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 10px; }
  .num { color: var(--accent); font-size: 13px; font-weight: 800;
         font-variant-numeric: tabular-nums; min-width: 22px; }
  .branch-step { margin-left: 26px; padding-left: 18px; border-left: 3px solid var(--rule); }
  .branch-step h3 .title { font-weight: 700; font-size: 15px; }

  /* Speaker blocks. The label sits in a left gutter rather than above the
     text, which is what makes a page of these scannable: a caller finds their
     next line by running down the red column, not by reading. The label is
     emitted as the first <strong> *inside* the paragraph, so it is lifted out
     with absolute positioning rather than by rewriting the HTML. */
  blockquote { margin: 12px 0; padding: 0 0 0 88px; border: 0; position: relative; }
  blockquote > p { margin: 0; padding: 12px 16px; border-radius: 4px; }
  blockquote[data-speaker="you"] > p { background: var(--you); }
  blockquote[data-speaker="prospect"] > p { background: var(--them); font-weight: 700; }
  blockquote > p > strong:first-child {
    position: absolute; left: 0; top: 13px; width: 76px;
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    font-weight: 800; line-height: 1.3; }
  blockquote[data-speaker="you"] > p > strong:first-child { color: var(--accent); }
  blockquote[data-speaker="prospect"] > p > strong:first-child { color: var(--muted); }

  /* "(let them answer)" and its like, lined up under the speaker block. */
  .body p em:only-child { color: var(--muted); font-size: 13px;
                          display: block; margin-left: 88px; }

  /* The A / B / C a prospect might say: parallel options, not consecutive
     steps, so they are lettered in the accent colour rather than headed. */
  .body h3 { font-size: 12px; font-weight: 800; margin: 22px 0 8px;
             color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; }
  .body p { margin: 10px 0; }
  .body ul { padding-left: 20px; }
  .body li { margin: 4px 0; }
  .body strong { font-weight: 700; }

  footer { margin-top: 48px; padding-top: 14px; border-top: 1px solid var(--rule);
           color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; }

  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 0; }
    @page { margin: 18mm 16mm; }
    /* Backgrounds are the whole design: without this Chrome prints the
       speaker blocks as plain text and the script loses its shape. */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2.family, .step { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>${escape(doc.title)}</h1>
    <span class="tag">Voice agents${doc.region ? ` &middot; ${REGION_LABEL[doc.region] ?? doc.region}` : ""}</span>
  </header>
  ${intro ? `<div class="intro">${tagSpeakers(md(intro))}</div>` : ""}
  ${blocks.join("\n")}
  <footer><span>Cyllabs</span><span>${escape(doc.slug)}</span></footer>
</div>
</body>
</html>
`;
}

