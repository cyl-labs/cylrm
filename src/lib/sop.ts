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
  /** A conditional step — a branch off the call rather than the next thing to
   *  say. Decided by the heading, so a script author marks one by writing "If
   *  …" and nothing else has to be kept in step. Branches are indented and
   *  left unnumbered, so the shape of the tree is visible instead of seven
   *  steps in a row implying you say all of them. */
  branch: boolean;
  html: string;
  /** Heading and body as plain text, lowercased, for the drawer's search. */
  search: string;
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
function toSections(md: string): { intro: string; sections: SopSection[] } {
  const parts = md.split(/^## /m);
  const intro = parts.shift() ?? "";
  const sections = parts.map((part) => {
    const at = part.indexOf("\n");
    const title = (at === -1 ? part : part.slice(0, at)).trim();
    const body = at === -1 ? "" : part.slice(at + 1);
    const html = marked.parse(body, { async: false }) as string;
    return {
      title,
      branch: /^(if|only if|otherwise)\b/i.test(title),
      html,
      search: `${title} ${stripTags(html)}`.toLowerCase(),
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
