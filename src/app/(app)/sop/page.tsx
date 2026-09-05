import Link from "next/link";
import { BookText, ChevronRight, MessageSquareWarning, ScrollText } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { callRegionOf } from "@/lib/users";
import { sopRegionFor } from "@/lib/calls";
import { listSopDocuments, type SopKind } from "@/lib/sop";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<SopKind, typeof ScrollText> = {
  script: ScrollText,
  objections: MessageSquareWarning,
  procedure: BookText,
};

/**
 * The library.
 *
 * One flat list, no regional grouping and no region labels: a caller works one
 * market, set on the Team screen, so only their documents are here and saying
 * "Singapore" beside every row is noise. Someone with no market set — an admin
 * reviewing both — sees everything, and only then is the region worth showing.
 *
 * Read-only: content is edited as markdown in `content/sop/` and published on
 * deploy.
 */
export default async function SopPage() {
  const me = await getCurrentUser();
  const region = await callRegionOf(me?.id);
  const isAdmin = me?.role === "admin";
  const docs = await listSopDocuments(sopRegionFor(region), isAdmin);

  return (
    <PageShell title="Scripts">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-5 sm:px-6">
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <p className="text-sm font-semibold">Nothing here yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Scripts appear once your market is set on the Team screen.
            </p>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {docs.map((d) => {
              const Icon = KIND_ICON[d.kind];
              return (
                <li key={d.slug}>
                  <Link
                    href={`/sop/${d.slug}`}
                    className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-muted/50"
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={2.2}
                    />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
                      {d.title}
                    </span>
                    {/* Only worth saying when someone is seeing more than one
                        market's worth — otherwise every row says the same
                        thing. */}
                    {!region && d.region && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {d.region === "sg" ? "Singapore" : "US"}
                      </span>
                    )}
                    {/* Every row here is already one only a founder can open,
                        so the label is not about access — it is so a founder
                        can tell at a glance which documents their callers
                        cannot see, before quoting one at somebody. */}
                    {d.adminOnly && (
                      <span className="shrink-0 rounded-[3px] bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-primary">
                        Founders
                      </span>
                    )}
                    <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                      {d.sections.length}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/60"
                      strokeWidth={2.2}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
