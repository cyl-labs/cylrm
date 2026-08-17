import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { SopProse } from "@/components/sop/sop-prose";
import { getCurrentUser } from "@/lib/session";
import { callRegionOf } from "@/lib/users";
import { getSopDocument } from "@/lib/sop";

export const dynamic = "force-dynamic";

/** Long enough that finding a section by scrolling stops being reasonable. */
const TOC_THRESHOLD = 6;

/** The heading's id, matching what the renderer emits. */
const anchor = (title: string, i: number) =>
  `s${i}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)}`;

export default async function SopDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const me = await getCurrentUser();
  // Scoped the same way the index is, so typing another region's slug into the
  // address bar gets the same not-found as a document that never existed.
  const doc = await getSopDocument(slug, await callRegionOf(me?.id));
  if (!doc) notFound();

  const showToc = doc.sections.length > TOC_THRESHOLD;

  return (
    <PageShell
      title={doc.title}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <Link
          href="/sop"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2.4} />
          All scripts
        </Link>

        <div className="mt-4 gap-8 lg:flex">
          {showToc && (
            // Sticky rather than fixed so it scrolls with the page on a phone
            // and parks itself on a desktop, and hidden below lg because a
            // narrow screen has no room to spare beside the words.
            <nav className="hidden shrink-0 lg:block lg:w-56">
              <div className="sticky top-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  On this page
                </p>
                <ul className="mt-2 flex flex-col gap-1.5 border-l">
                  {doc.sections.map((s, i) => (
                    <li key={s.title}>
                      <a
                        href={`#${anchor(s.title, i)}`}
                        className="-ml-px block border-l-2 border-transparent pl-3 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          )}

          {/* A readable measure: prose past roughly 70 characters a line is
              hard to scan, and this is read under pressure. */}
          <article className="min-w-0 max-w-[68ch] flex-1">
            {doc.introHtml && (
              <SopProse
                html={doc.introHtml}
                className="mb-6 text-muted-foreground"
              />
            )}
            {doc.sections.map((s, i) => (
              <section key={s.title} className="mt-7 first:mt-0">
                <h2
                  id={anchor(s.title, i)}
                  className="scroll-mt-6 text-[15px] font-extrabold tracking-[-0.01em]"
                >
                  <span className="mr-2 text-muted-foreground/70 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </h2>
                <SopProse html={s.html} className="mt-2" />
              </section>
            ))}
          </article>
        </div>
      </div>
    </PageShell>
  );
}
