import Link from "next/link";
import { BookText, ChevronRight, MessageSquareWarning, ScrollText } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { callScope, getCurrentUser } from "@/lib/session";
import { listSopDocuments, type SopDoc, type SopKind } from "@/lib/sop";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<SopKind, typeof ScrollText> = {
  script: ScrollText,
  objections: MessageSquareWarning,
  procedure: BookText,
};

/**
 * Grouped by region, not by kind.
 *
 * Kind-first put two rows called "Cold Calling Script" under a heading called
 * Scripts, told apart only by a badge at the far right — three words of
 * repetition and a scan across the whole row to answer "which one is mine".
 * A caller works one region, so the region is the question they are actually
 * asking, and inside a group the titles differ on their own.
 */
const GROUPS: { key: "sg" | "us" | "shared"; label: string }[] = [
  { key: "sg", label: "Singapore" },
  { key: "us", label: "US" },
  { key: "shared", label: "Everyone" },
];

export default async function SopPage() {
  const me = await getCurrentUser();
  const docs = await listSopDocuments(callScope(me));

  const bucket = (d: SopDoc) => d.region ?? "shared";

  return (
    <PageShell title="Scripts">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6">
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <p className="text-sm font-semibold">Nothing here yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Scripts appear once a niche is assigned to you.
            </p>
          </div>
        ) : (
          GROUPS.map(({ key, label }) => {
            const group = docs.filter((d) => bucket(d) === key);
            if (group.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                  {label}
                </h2>
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {group.map((d) => {
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
              </section>
            );
          })
        )}

        {/* Said plainly rather than left as an empty heading: there are no
            procedures yet because none have been written, and an empty
            section reads like something is broken. */}
        {!docs.some((d) => d.kind === "procedure") && (
          <p className="px-1 text-[13px] text-muted-foreground">
            No procedures yet. They live alongside the scripts once written,
            and apply to everyone whichever region they call.
          </p>
        )}
      </div>
    </PageShell>
  );
}
