import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ISSUE_TITLE, type SendIssue } from "@/lib/send-issues";

const relative = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * Sending problems the scheduler hit. Rendered only when there are unresolved
 * ones — a successful send for the same campaign or account clears them, so an
 * empty card would mean "no news", which is not worth a permanent fixture.
 */
export function SendIssuesCard({ issues }: { issues: SendIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <Card className="border-destructive/40 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {issues.length === 1
            ? "1 problem is stopping emails"
            : `${issues.length} problems are stopping emails`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {issues.map((issue) => (
          <div key={issue.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">
                {ISSUE_TITLE[issue.kind]}
              </span>
              {issue.accountEmail && (
                <Badge variant="outline" className="text-[11px]">
                  {issue.accountEmail}
                </Badge>
              )}
              {issue.campaignName && (
                <Badge variant="outline" className="text-[11px]">
                  {issue.campaignName}
                </Badge>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {relative(issue.lastSeenAt)}
                {issue.occurrences > 1 && ` · ${issue.occurrences}×`}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {issue.detail}
            </p>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          These clear themselves once a send succeeds again.
        </p>
      </CardContent>
    </Card>
  );
}
