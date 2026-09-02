import { sql } from "drizzle-orm";
import { marked } from "marked";
import { db } from "@/db";
import type { SopRegion } from "@/lib/calls";

/**
 * The scripts and procedures callers work from.
 *
 * Markdown is turned into HTML here rather than in the browser: the parser
 * stays out of the client bundle, and the drawer needs the document split into
 * sections — one per objection — to collapse and search them, which a single
 * blob of HTML could not give it.
 */

export type SopKind = "script" | "objections" | "procedure";

export type SopSection = {
  /** The `##` heading, verbatim. On an objection sheet this is the objection
   *  as a prospect actually says it, which is what the drawer lists. */
  title: string;
  /** The group this belongs to, written as "Category | Title" in the heading.
   *  Fifteen objections is a list you read; five groups is something you scan
   *  while somebody is talking. Null on documents that do not group. */
  category: string | null;
  /** A conditional step — a branch off the call rather than the next thing to
   *  say. Decided by the heading, so a script author marks one by writing "If
   *  …" and nothing else has to be kept in step. Branches are indented and
   *  left unnumbered, so the shape of the tree is visible instead of seven
   *  steps in a row implying you say all of them. */
  branch: boolean;
  html: string;
  /** Heading and body as plain text, lowercased, for the drawer's search. */
  search: string;
  /**
   * Just the lines a caller says out loud — the `> **You say**` blockquotes and
   * the stage directions between them — rendered in document order.
   *
   * Split out for the live hint, which appears mid-sentence and has to be
   * readable at a glance. Sections are not uniform: most are purely spoken
   * lines, but some carry paragraphs of coaching around them (`Machine
   * screening` is fifteen lines of explanation around one sentence), and
   * dumping that on screen during a call buries the thing they need.
   */
  responseHtml: string;
  /** Everything else in the section: the coaching, the reasoning, the caveats.
   *  Worth having, never worth reading while a prospect waits. */
  contextHtml: string;
  /**
   * The `> **Prospect** "…"` lines: what a prospect says that lands you here.
   *
   * On the objection sheet the `title` already is that, so this is empty. On
   * the script it is the only usable label — the headings there describe what
   * the *caller* does next ("Their answer will be one of these three"), and the
   * three answers it is naming live in `###` sub-beats that never become
   * sections of their own. Without this, "I answer them" has no label to match.
   */
  prospectCues: string[];
};

export type SopDoc = {
  id: number;
  slug: string;
  kind: SopKind;
  region: SopRegion | null;
  title: string;
  updatedAt: string;
  sections: SopSection[];
  /** Anything before the first `##` — the lead-in line. */
  introHtml: string;
};

type Row = {
  id: number;
  slug: string;
  kind: SopKind;
  region: SopRegion | null;
  title: string;
  body_md: string;
  updated_at: string;
};

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Split a document at its `##` headings.
 *
 * Done on the raw markdown rather than on rendered HTML: the headings are the
 * only structure that matters, splitting text is cheap, and it avoids parsing
 * HTML back out of a string to find them again.
 */
/**
 * Split a section body into the lines said aloud and everything else.
 *
 * Done on the markdown, where a spoken line is unambiguously a blockquote led
 * by `**You say**` and a stage direction is an italic line in brackets. Doing
 * it on rendered HTML would mean matching tags back out of a string, which is
 * the thing `toSections` already avoids.
 */
function splitSpoken(body: string): { response: string; context: string } {
  const spoken: string[] = [];
  const rest: string[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    if (/^>\s*\*\*You say\*\*/.test(b) || /^_\(.*\)_$/.test(b)) spoken.push(b);
    else rest.push(b);
  }
  return { response: spoken.join("\n\n"), context: rest.join("\n\n") };
}

function toSections(md: string): { intro: string; sections: SopSection[] } {
  const parts = md.split(/^## /m);
  const intro = parts.shift() ?? "";
  const sections = parts.map((part) => {
    const at = part.indexOf("\n");
    const heading = (at === -1 ? part : part.slice(0, at)).trim();
    const bar = heading.indexOf(" | ");
    const category = bar === -1 ? null : heading.slice(0, bar).trim();
    const title = bar === -1 ? heading : heading.slice(bar + 3).trim();
    const body = at === -1 ? "" : part.slice(at + 1);
    const html = marked.parse(body, { async: false }) as string;
    const { response, context } = splitSpoken(body);
    // Includes the `###` sub-beats' quotes, which is the point: they never
    // become sections, so their cues would otherwise be unreachable.
    const prospectCues = [...body.matchAll(/^>\s*\*\*Prospect\*\*\s*(.+)$/gm)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    return {
      title,
      category,
      branch: /^(if|only if|otherwise)\b/i.test(title),
      html,
      search: `${title} ${stripTags(html)}`.toLowerCase(),
      responseHtml: response ? (marked.parse(response, { async: false }) as string) : "",
      contextHtml: context ? (marked.parse(context, { async: false }) as string) : "",
      prospectCues,
    };
  });
  return {
    intro: intro.trim() ? (marked.parse(intro, { async: false }) as string) : "",
    sections,
  };
}

function toDoc(r: Row): SopDoc {
  const { intro, sections } = toSections(r.body_md);
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    region: r.region,
    title: r.title,
    updatedAt: new Date(r.updated_at).toISOString(),
    introHtml: intro,
    sections,
  };
}

/**
 * Every document this person may open.
 *
 * Filtered by the market they are set to work, not by the leads in front of
 * them: a caller works one market all day, and deriving it per lead meant the
 * library had to carry every region's document at once, labelled, so nobody
 * could tell at a glance which was theirs. Null means show everything, which
 * is what an admin reviewing both markets wants.
 */
export async function listSopDocuments(
  region: SopRegion | null,
): Promise<SopDoc[]> {
  const rows = (await db.execute(sql`
    select id, slug, kind, region, title, body_md, updated_at
    from sop_document
    ${region ? sql`where region is null or region = ${region}` : sql``}
    order by
      case kind when 'script' then 1 when 'objections' then 2 else 3 end,
      region nulls first,
      title
  `)) as Row[];
  return rows.map(toDoc);
}

/** One document, scoped the same way the index is. */
export async function getSopDocument(
  slug: string,
  region: SopRegion | null,
): Promise<SopDoc | null> {
  const all = await listSopDocuments(region);
  return all.find((d) => d.slug === slug) ?? null;
}

/**
 * The script and objection sheet the dialler shows, for one market.
 *
 * One region, resolved server-side from the caller, so nothing has to be
 * chosen or switched while a call is in progress.
 */
export async function getDiallerSop(region: SopRegion | null): Promise<{
  script: SopSection[];
  objections: SopSection[];
}> {
  if (!region) return { script: [], objections: [] };
  const rows = (await db.execute(sql`
    select id, slug, kind, region, title, body_md, updated_at
    from sop_document
    where region = ${region} and kind in ('script', 'objections')
  `)) as Row[];
  const docs = rows.map(toDoc);
  return {
    script: docs.find((d) => d.kind === "script")?.sections ?? [],
    objections: docs.find((d) => d.kind === "objections")?.sections ?? [],
  };
}
