import { Card, CardContent } from "@/components/ui/card";
import { WindowClock } from "@/components/campaigns/window-clock";
import type { CampaignProgress } from "@/lib/campaign-progress";

/**
 * Today at a glance, separate from the campaign-long numbers above it.
 *
 * The target is what this campaign could still get out before the window
 * shuts, which is a ceiling rather than a forecast: it accounts for daily
 * caps and how many ticks are left, but not for the pacing gaps that make a
 * mailbox skip some of them.
 */
export function TodayCard({ p }: { p: CampaignProgress }) {
  const couldStillSend = Math.min(p.capacityLeftToday, p.remaining);
  const target = p.sentToday + couldStillSend;
  const percent = target === 0 ? 0 : Math.round((p.sentToday / target) * 100);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">
              {p.sentToday.toLocaleString()}
            </span>
            <span className="text-[13px] text-muted-foreground">
              of {target.toLocaleString()} sent today
            </span>
          </div>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {percent}%
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>

        <WindowClock
          start={p.window.start}
          end={p.window.end}
          timezone={p.window.timezone}
          weekdaysOnly={p.window.weekdaysOnly}
        />

        <p className="text-xs leading-relaxed text-muted-foreground">
          {p.window.open
            ? couldStillSend > 0
              ? `Room for about ${couldStillSend.toLocaleString()} more before the window shuts: a ceiling, not a promise, since each mailbox sends at most one email every 5 minutes and paces itself across the day.`
              : p.remaining > 0
                ? `Today's sending finished: ${p.sentToday.toLocaleString()} went out and every mailbox has reached its daily cap. The remaining ${p.remaining.toLocaleString()} pick up when the window next opens, or sooner if you raise the caps on the Accounts screen.`
                : `Today's sending finished: ${p.sentToday.toLocaleString()} went out and this campaign owes nothing more.`
            : p.sentToday > 0
              ? `The window is shut for today: ${p.sentToday.toLocaleString()} went out. Sending picks up when it next opens.`
              : "Nothing has gone out today. Sending starts when the window opens."}
          {p.activeCampaigns > 1 &&
            ` Today's room is shared with ${p.activeCampaigns - 1} other active campaign${p.activeCampaigns > 2 ? "s" : ""}.`}
        </p>
      </CardContent>
    </Card>
  );
}
