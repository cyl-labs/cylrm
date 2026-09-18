import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { SopProse } from "@/components/sop/sop-prose";
import { PricingCalculator } from "@/components/sop/pricing-calculator";
import {
  DemoFilledProse,
  DemoNumbersProvider,
} from "@/components/sop/demo-numbers";
import { hasDemoFills } from "@/lib/demo-calc";
import { getCurrentUser } from "@/lib/session";
import { callerNumberOf, callRegionOf } from "@/lib/users";
import { sopRegionFor } from "@/lib/calls";
import { spokenNumber } from "@/lib/phone";
import { getSopDocument } from "@/lib/sop";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Where the demo calculator goes, written in the content rather than here.
 *
 * A line reading `[calculator]` in the markdown is replaced by the component,
 * so the person editing the document decides where it sits — it started at the
 * top of the page and belonged next to the sum it does. Left unhandled the
 * marker renders as its own literal text, which is the failure mode to want: a
 * misplaced or misspelled one is visible on the page rather than silently
 * dropping the calculator.
 */
const CALCULATOR_MARKER = "[calculator]";

/**
 * Where a video guide goes: a line reading `[video: crm-guide]` in the
 * markdown, named like the calculator's marker so a document decides both what
 * it shows and where.
 *
 * The file itself is not in the repo — see `/api/guides/[slug]`, which is also
 * what keeps it behind the login.
 */
const VIDEO_MARKER = /\[video:\s*([a-z0-9][a-z0-9-]{0,60})\]/;

/** Long enough that finding a section by scrolling stops being reasonable. */
const TOC_THRESHOLD = 6;

/**
 * Sections filed under this heading (`## Objection handling | If …`) move to
 * the left column on a wide screen, in place of the contents list.
 *
 * Asked for on Closing the Demo (2026-09-17): its three objections sat in the
 * middle of the close, and a founder mid-demo wants the answer to "that's too
 * expensive" without losing their place in the steps. Each one opens in the
 * column, so the close does not move. Below `lg` there is no column, and they
 * stay where the document puts them. Written in the content, like the
 * calculator marker, so the document decides what goes there.
 */
const SIDE_CATEGORY = "Objection handling";

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
  //
  // The script is read as this person's own, so "[your number]" is filled in
  // with the number assigned to them — the one thing in it they have no way to
  // look up.
  const did = await callerNumberOf(me?.id);
  const doc = await getSopDocument(
    slug,
    sopRegionFor(await callRegionOf(me?.id)),
    me?.role === "admin",
    { number: did ? spokenNumber(did) : null },
  );
  if (!doc) notFound();

  const side = doc.sections.filter((s) => s.category === SIDE_CATEGORY);
  const showToc = side.length === 0 && doc.sections.length > TOC_THRESHOLD;
  const hasCalculator = doc.sections.some((s) => s.html.includes(CALCULATOR_MARKER));

  // A section's words, with the calculator's figures written in where the
  // document has a calculator to answer them. Only the sections that ask get
  // the client version, so every other section stays server-only.
  const prose = (
    s: (typeof doc.sections)[number],
    className: string,
    gutter = true,
  ) => {
    const html = s.html
      .replace(`<p>${CALCULATOR_MARKER}</p>`, "")
      .replace(new RegExp(`<p>${VIDEO_MARKER.source}</p>`), "");
    return hasCalculator && hasDemoFills(html) ? (
      <DemoFilledProse html={html} className={className} gutter={gutter} />
    ) : (
      <SopProse html={html} className={className} gutter={gutter} />
    );
  };
  // Founders only, and only for a document that may leave the building.
  const canExport =
    me?.role === "admin" && !doc.adminOnly && Boolean(process.env.GOTENBERG_URL);

  // Consecutive sections sharing a heading become one collapsible chapter.
  // Built here rather than inline so the anchor index stays the section's
  // real position in the document - grouping must not renumber the links.
  const tocGroups: {
    category: string | null;
    items: { section: (typeof doc.sections)[number]; index: number }[];
  }[] = [];
  doc.sections.forEach((section, index) => {
    const category = section.category ?? null;
    const last = tocGroups[tocGroups.length - 1];
    if (last && last.category === category) last.items.push({ section, index });
    else tocGroups.push({ category, items: [{ section, index }] });
  });

  return (
    <PageShell title={doc.title}>
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/sop"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2.4} />
            All scripts
          </Link>
          {/* The handout, for somebody with no CRM account — an interviewee,
              mostly. Founders only, and never offered on a founders-only
              document: those carry the prices and the ROI maths, and the route
              refuses them too. Absent rather than dead when no PDF service is
              configured, the same rule the contract buttons follow. */}
          {canExport && (
            <a
              href={`/api/sop/${doc.slug}/pdf`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              <FileDown className="size-3.5" strokeWidth={2.2} />
              Export as PDF
            </a>
          )}
        </div>

        {/* The calculator's two boxes are held here, above both columns, so a
            script line anywhere on the page can say the figures back. */}
        <DemoNumbersProvider>
          <div className="mt-4 gap-8 lg:flex">
            {side.length > 0 && (
              // Open one when they push back; the close in the middle stays
              // where it was. One open at a time (`name`), since two long
              // answers stacked is a column that has to be scrolled to find
              // the second. Its own scroll, sticky, the same as the contents
              // list it replaces.
              <aside
                aria-label={SIDE_CATEGORY}
                className="hidden shrink-0 lg:block lg:w-72 xl:w-80"
              >
                <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    {SIDE_CATEGORY}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Open one when they push back. The close stays where you left it.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {side.map((s) => (
                      <details key={s.title} name="objection-handling" className="group/obj">
                        <summary className="flex cursor-pointer list-none items-start gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-[13px] font-bold leading-snug text-primary [&::-webkit-details-marker]:hidden">
                          <ChevronRight
                            aria-hidden
                            className="mt-0.5 size-3.5 shrink-0 transition-transform group-open/obj:rotate-90"
                          />
                          <span className="min-w-0">{s.title}</span>
                        </summary>
                        {prose(s, "mt-2 mb-4 px-1 text-[14px]", false)}
                      </details>
                    ))}
                  </div>
                </div>
              </aside>
            )}
            {showToc && (
              // Sticky rather than fixed so it scrolls with the page on a phone
              // and parks itself on a desktop, and hidden below lg because a
              // narrow screen has no room to spare beside the words.
              <nav className="hidden shrink-0 lg:block lg:w-64">
                {/* Collapsed chapters rather than one long list. Fifteen
                    objections under five headings overflowed any screen, and a
                    box that scrolls inside a page that also scrolls gives two
                    scrollbars fighting under one cursor. Closed, the whole nav
                    is five rows and never needs to scroll at all.

                    Native <details>, so this stays a server component and the
                    open/closed state survives without any JavaScript. */}
                <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    On this page
                  </p>
                  <div className="mt-3 flex flex-col gap-1">
                    {tocGroups.map((g) => {
                      const links = (
                        // Hairlines between entries, not just spacing: these
                        // titles are whole sentences that wrap to two lines, so
                        // without a rule the second line of one reads as the
                        // start of the next.
                        <ul className="flex flex-col divide-y divide-border/60">
                          {g.items.map(({ section, index }) => (
                            <li key={section.title}>
                              <a
                                href={`#${anchor(section.title, index)}`}
                                className={cn(
                                  "-ml-px block border-l-2 border-transparent py-2 pl-3 text-[13px] leading-snug text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
                                  g.category && "ml-2",
                                  section.branch && "pl-6 text-[12px] opacity-75",
                                )}
                              >
                                {section.branch && (
                                  <span aria-hidden className="mr-1">
                                    ↳
                                  </span>
                                )}
                                {section.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      );

                      // No heading to hang them under, so nothing to collapse.
                      if (!g.category) {
                        return <div key="ungrouped">{links}</div>;
                      }

                      return (
                        <details key={g.category} className="group/toc">
                          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[13px] font-extrabold tracking-[-0.01em] text-primary [&::-webkit-details-marker]:hidden">
                            <ChevronRight
                              aria-hidden
                              className="size-3.5 shrink-0 transition-transform group-open/toc:rotate-90"
                            />
                            <span className="min-w-0">{g.category}</span>
                            <span className="ml-auto text-[11px] font-bold opacity-60">
                              {g.items.length}
                            </span>
                          </summary>
                          <div className="mt-1 mb-1">{links}</div>
                        </details>
                      );
                    })}
                  </div>
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
                  const newGroup =
                    s.category && s.category !== doc.sections[i - 1]?.category;
                  return (
                    <section
                      key={s.title}
                      data-group={newGroup ? s.category : undefined}
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
                        // In the left column instead, where there is one.
                        s.category === SIDE_CATEGORY && "lg:hidden",
                      )}
                    >
                      {newGroup && (
                        <p className="mb-5 text-lg font-extrabold tracking-[-0.02em] text-primary">
                          {s.category}
                        </p>
                      )}
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
                          <span className="rounded-[3px] bg-[#EDEDED] px-1.5 py-0.5 dark:bg-[#3a3a37]">
                            {s.title}
                          </span>
                        ) : (
                          s.title
                        )}
                      </h2>
                      {prose(s, "mt-3")}
                      {/* Where the numbers are collected, not beside the
                          arithmetic they feed. Its two boxes are the two
                          questions in "get their numbers", so a founder types
                          each figure as the prospect says it. It sat under "do
                          the math out loud" until 2026-09-16, one step further
                          down, which asked somebody mid-demo to hold both numbers
                          in their head across a scroll — and they didn't, which
                          is the complaint that moved it. Still never at the top
                          of the page: a calculator away from the words is one
                          they scroll past and do the sum without.

                          The marker's position *within* a section does not
                          matter. The section's prose renders first and this is
                          appended after it, so the calculator always lands at the
                          foot of whichever section carries the marker. Move it by
                          moving it between sections, and expect it at the bottom
                          of the one it lands in. */}
                      {s.html.includes(CALCULATOR_MARKER) && (
                        <div className="mt-4">
                          <PricingCalculator />
                        </div>
                      )}
                      {/* `preload="metadata"`: the file is tens of megabytes
                          and this page is opened to read the script far more
                          often than to watch anything, so nothing is fetched
                          until somebody presses play. */}
                      {VIDEO_MARKER.exec(s.html)?.[1] && (
                        <video
                          className="mt-4 w-full rounded-xl border bg-black"
                          controls
                          preload="metadata"
                          playsInline
                          src={`/api/guides/${VIDEO_MARKER.exec(s.html)![1]}`}
                        />
                      )}
                    </section>
                  );
                });
              })()}
            </article>
          </div>
        </DemoNumbersProvider>
      </div>
    </PageShell>
  );
}
