import Link from "next/link";
import { BookText, MessageSquareWarning, ScrollText } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { callScope, getCurrentUser } from "@/lib/session";
import { listSopDocuments, type SopKind } from "@/lib/sop";

export const dynamic = "force-dynamic";

const GROUPS: { kind: SopKind; label: string; blurb: string; icon: typeof BookText }[] =
  [
    {
      kind: "script",
      label: "Scripts",
      blurb: "What to say, in order, from the opener to the close.",
      icon: ScrollText,
    },
    {
      kind: "objections",
      label: "Objection handling",
      blurb: "These come up anywhere in the call. Also one tap away in the dialler.",
      icon: MessageSquareWarning,
    },
    {
      kind: "procedure",
      label: "Procedures",
      blurb: "How things are done here, whichever region you call.",
      icon: BookText,
    },
  ];

const REGION_LABELS: Record<string, string> = {
  sg: "Singapore",
  us: "US",
};

/**
 * The library.
 *
 * Read-only: content is edited as markdown in `content/sop/` and published on
 * deploy, so there is nothing to add, edit or delete from here.
 */
export default async function SopPage() {
  const me = await getCurrentUser();
  const docs = await listSopDocuments(callScope(me));

  return (
    <PageShell title="Scripts">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <p className="text-sm font-semibold">Nothing here yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Scripts appear once a niche is assigned to you.
            </p>
          </div>
        ) : (
          GROUPS.map(({ kind, label, blurb, icon: Icon }) => {
            const group = docs.filter((d) => d.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind}>
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" strokeWidth={2.2} />
                  <h2 className="text-sm font-extrabold tracking-[-0.01em]">
                    {label}
                  </h2>
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{blurb}</p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {group.map((d) => (
                    <li key={d.slug}>
                      <Link
                        href={`/sop/${d.slug}`}
                        className="flex items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/50 sm:p-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold tracking-[-0.01em]">
                            {d.title}
                          </p>
                          <p className="mt-0.5 text-[13px] text-muted-foreground">
                            {d.sections.length}{" "}
                            {d.kind === "objections" ? "objections" : "sections"}
                          </p>
                        </div>
                        {d.region && (
                          <Badge variant="secondary" className="shrink-0">
                            {REGION_LABELS[d.region] ?? d.region}
                          </Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </PageShell>
  );
}
