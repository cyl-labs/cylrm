import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
// The same renderer `scripts/export-sop.mjs` uses, so the PDF downloaded here
// and the handout generated on a laptop are the same document. Plain ESM for
// that reason — a bare node script cannot import a TypeScript module.
import { render } from "@/lib/handout.mjs";

/**
 * A document as a PDF, for sending to somebody with no CRM account.
 *
 * Founders only. The handouts go to interviewees, and deciding what leaves the
 * building is not a caller's call — the same reasoning that keeps the export
 * script's refusal below.
 *
 * The PDF is made by the Gotenberg already running on the droplet rather than
 * by a library added here: it is a container that turns HTML into PDF and
 * nothing else, it is on localhost, and the alternative was shipping a headless
 * browser to a box with 2GB of RAM. Unset or unreachable means the button is
 * not offered — see the page — and this answers plainly rather than throwing.
 */
const GOTENBERG = process.env.GOTENBERG_URL?.replace(/\/+$/, "");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Exporting a document is admin-only." },
      { status: 403 },
    );
  }
  if (!GOTENBERG) {
    return Response.json(
      { error: "No PDF service is configured on this server." },
      { status: 503 },
    );
  }

  const { slug } = await params;
  const [row] = (await db.execute(sql`
    select slug, title, region, admin_only, body_md
    from sop_document where slug = ${slug}
  `)) as {
    slug: string;
    title: string;
    region: string | null;
    admin_only: boolean;
    body_md: string;
  }[];

  if (!row) return Response.json({ error: "Not found." }, { status: 404 });

  // Refused even for a founder, and even by name — the same rule the export
  // script applies. These files exist to be sent to people outside the company,
  // and `audience: admins` is the demo call, the ROI maths and the commercial
  // terms. A founder who wants it on paper has the screen and Cmd-P.
  if (row.admin_only) {
    return Response.json(
      { error: "Founders-only documents are not exported." },
      { status: 403 },
    );
  }

  const html: string = render({
    slug: row.slug,
    title: row.title,
    region: row.region,
    body: row.body_md,
    adminOnly: false,
  });

  // Gotenberg takes the page as a multipart upload named index.html; the
  // document is self-contained (its CSS is inline), so nothing else is sent.
  const form = new FormData();
  form.append(
    "files",
    new Blob([html], { type: "text/html" }),
    "index.html",
  );
  // Margins live in the document's own `@page` rule, which is what the handout
  // was designed around — these only stop Gotenberg adding a second set.
  form.append("marginTop", "0");
  form.append("marginBottom", "0");
  form.append("marginLeft", "0");
  form.append("marginRight", "0");
  form.append("printBackground", "true");

  const res = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, {
    method: "POST",
    body: form,
  }).catch(() => null);

  if (!res?.ok) {
    return Response.json(
      {
        error: `Could not render the PDF${res ? ` (${res.status})` : ": the PDF service did not answer"}.`,
      },
      { status: 502 },
    );
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "application/pdf",
      // `attachment` so it downloads rather than opening in a tab: this is a
      // file somebody is about to email, not something to read here.
      "Content-Disposition": `attachment; filename="${row.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
