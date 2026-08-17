import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { SopProse } from "@/components/sop/sop-prose";
import { getCurrentUser } from "@/lib/session";
import { callRegionOf } from "@/lib/users";
import { sopRegionFor } from "@/lib/calls";
import { getSopDocument } from "@/lib/sop";
import { cn } from "@/lib/utils";

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
  const doc = await getSopDocument(slug, sopRegionFor(await callRegionOf(me?.id)));
  if (!doc) notFound();

  const showToc = doc.sections.length > TOC_THRESHOLD;

  return (
    <PageShell title={doc.title}>
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
                        className={cn(
                          "-ml-px block border-l-2 border-transparent pl-3 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
                          s.branch && "pl-6 text-[12px] opacity-75",
                        )}
                      >
                        {s.branch && (
                          <span aria-hidden className="mr-1">
                            ↳
                          </span>
                        )}
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
            {/* Steps are numbered; branches are not. Numbering a conditional
                "If they say not interested" as step 06 says you always reach
                it, which is the opposite of true — so branches indent off the
                step above and carry a ↳ instead of a number. */}
            {(() => {
              let step = 0;
              let depth = 0;
              return doc.sections.map((s, i) => {
                if (s.branch) depth = Math.min(depth + 1, 2);
                else {
                  step += 1;
                  depth = 0;
                }
                return (
                  <section
                    key={s.title}
                    className={cn(
                      // A step is a thing you do, then stop, then do the next
                      // one. Run together they read as one wall of dialogue,
                      // so each gets a rule above it and room to breathe, the
                      // way the printed sheet separates them.
                      "mt-10 border-t pt-7 first:mt-0 first:border-t-0 first:pt-0",
                      s.branch &&
                        "mt-5 border-t-0 pt-0 border-l-2 border-dashed border-border pl-4 sm:pl-5",
                      s.branch && depth === 1 && "ml-1 sm:ml-3",
                      s.branch && depth >= 2 && "ml-6 sm:ml-10",
                    )}
                  >
                    <h2
                      id={anchor(s.title, i)}
                      className={cn(
                        "scroll-mt-6 tracking-[-0.01em]",
                        s.branch
                          ? "text-[13px] font-bold text-muted-foreground"
                          : "text-[15px] font-extrabold",
                      )}
                    >
                      <span
                        aria-hidden
                        className="mr-2 text-muted-foreground/70 tabular-nums"
                      >
                        {s.branch ? "↳" : String(step).padStart(2, "0")}
                      </span>
                      {/* An objection is quoted speech, so it gets the
                          highlighter the printed sheet gives it. The rest of
                          the headings are instructions and stay plain. */}
                      {s.title.startsWith("Prospect:") ? (
                        <span className="rounded-[3px] bg-[#EDEDED] px-1.5 py-0.5 dark:bg-[#26262a]">
                          {s.title}
                        </span>
                      ) : (
                        s.title
                      )}
                    </h2>
                    <SopProse html={s.html} className="mt-3" />
                  </section>
                );
              });
            })()}
          </article>
        </div>
      </div>
    </PageShell>
  );
}
