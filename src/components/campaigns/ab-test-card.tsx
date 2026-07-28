import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VariantStats } from "@/lib/stats";

const pct = (num: number, den: number) =>
  den === 0 ? "—" : `${((num / den) * 100).toFixed(1)}%`;

function Arm({
  armName,
  stats,
  testedSteps,
}: {
  armName: string;
  stats: VariantStats;
  testedSteps: number[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-xs font-medium text-muted-foreground">
          {armName}
          {stats.label && (
            <span className="text-foreground"> · {stats.label}</span>
          )}
        </p>
        {testedSteps.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            differs at step{testedSteps.length === 1 ? "" : "s"}{" "}
            {testedSteps.join(", ")}
          </p>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-[-0.02em]">
        {pct(stats.replies, stats.sent)}
      </p>
      <p className="text-[13px] text-muted-foreground">
        reply rate — {stats.replies.toLocaleString()} of{" "}
        {stats.sent.toLocaleString()} sent
      </p>
      <p className="text-[13px] text-muted-foreground">
        {stats.contacts.toLocaleString()} contacts · {stats.demos.toLocaleString()}{" "}
        demo{stats.demos === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * A vs B for this campaign. Rendered only when at least one step actually has
 * a B version — before that every contact gets the A copy and the arms would
 * be comparing identical emails.
 */
export function AbTestCard({
  stats,
  testedSteps,
}: {
  stats: Record<"a" | "b", VariantStats>;
  testedSteps: number[];
}) {
  const sent = stats.a.sent + stats.b.sent;
  // The blueprint's own caveat: at these volumes anything short of a large
  // gap is noise, and saying so beats letting a 3-reply lead look decisive.
  const tooEarly = Math.min(stats.a.sent, stats.b.sent) < 100;

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">A/B test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <Arm armName="Version A" stats={stats.a} testedSteps={testedSteps} />
          <div className="sm:border-l sm:pl-5">
            <Arm armName="Version B" stats={stats.b} testedSteps={testedSteps} />
          </div>
        </div>
        {sent === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing sent yet. Contacts are split evenly between the two versions
            when you enroll them.
          </p>
        ) : tooEarly ? (
          <p className="text-[13px] text-muted-foreground">
            Too early to call — under 100 sends on one side, where a few replies
            either way swing the rate. Differences smaller than roughly 2× are
            noise at this volume.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
