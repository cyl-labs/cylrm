import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/page-shell";

export function ScreenStub({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <PageShell title={title}>
      <div className="flex h-full flex-col items-center justify-center px-6 py-16">
        <Badge variant="secondary" className="text-xs font-medium">
          Coming in {phase}
        </Badge>
        <h2 className="mt-3 text-sm font-semibold tracking-[-0.01em]">
          {`${title} isn't built yet`}
        </h2>
        <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </PageShell>
  );
}
