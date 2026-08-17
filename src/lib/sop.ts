import { sql } from "drizzle-orm";
import { marked } from "marked";
import { db } from "@/db";
import { sopRegion, type SopRegion } from "@/lib/calls";

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
    return { title, html, search: `${title} ${stripTags(html)}`.toLowerCase() };
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
 * A caller sees the regions they actually work — derived from the leads on the
 * lists assigned to them, so nobody has to maintain a second list of who works
 * where — plus every shared procedure. An admin sees all of it.
 */
export async function listSopDocuments(ownerId?: number): Promise<SopDoc[]> {
  const rows = (await db.execute(sql`
    select id, slug, kind, region, title, body_md, updated_at
    from sop_document
    order by
      case kind when 'script' then 1 when 'objections' then 2 else 3 end,
      region nulls first,
      title
  `)) as Row[];
  const docs = rows.map(toDoc);
  if (ownerId === undefined) return docs;

  // Which regions this caller actually works, decided by running their own
  // leads through `sopRegion` rather than re-deriving the rule in SQL. That
  // rule lives in exactly one place, so adding a GB variant stays the one-line
  // change it is meant to be. Distinct numbers only, so this is a few hundred
  // rows even on the largest assignment.
  const phones = (await db.execute(sql`
    select distinct l.phone
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    where cl.assigned_user_id = ${ownerId}
      and l.duplicate_of_lead_id is null
  `)) as { phone: string }[];

  const mine = new Set(
    phones.map((p) => sopRegion(p.phone)).filter(Boolean) as SopRegion[],
  );
  return docs.filter((d) => d.region === null || mine.has(d.region));
}

/** One document, scoped the same way the index is. */
export async function getSopDocument(
  slug: string,
  ownerId?: number,
): Promise<SopDoc | null> {
  const all = await listSopDocuments(ownerId);
  return all.find((d) => d.slug === slug) ?? null;
}

/**
 * Both objection sheets, for the dialler.
 *
 * Both, because the region follows the lead in front of the caller and that
 * changes as the queue advances — fetching per lead would mean a request in
 * the middle of a live call. Two documents is a few kilobytes.
 */
export async function getObjectionSheets(): Promise<
  Record<SopRegion, SopDoc | null>
> {
  const rows = (await db.execute(sql`
    select id, slug, kind, region, title, body_md, updated_at
    from sop_document
    where kind = 'objections'
  `)) as Row[];
  const docs = rows.map(toDoc);
  return {
    sg: docs.find((d) => d.region === "sg") ?? null,
    us: docs.find((d) => d.region === "us") ?? null,
  };
}
