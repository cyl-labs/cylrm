import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TICK_MINUTES, type CampaignProgress } from "@/lib/campaign-progress";

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums tracking-[-0.01em]">
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Postgres `time` columns come back as HH:MM:SS. */
const hhmm = (t: string) => t.slice(0, 5);

/**
 * What "due now" will actually do on the next tick.
 *
 * The ceiling is one email per account per tick, not the whole queue — so
 * saying "goes out next tick" is only true while the number due fits inside
 * the account pool. Beyond that it drains a tick at a time, and beyond
 * today's remaining cap it doesn't finish today at all.
 */
function dueHint(p: CampaignProgress): string {
  if (p.dueNow === 0) return "queue is clear";
  const perTick = p.eligibleAccounts;
  if (perTick === 0) return "no account can send";
  if (p.dueNow <= perTick) return "all of it goes out next tick";
  const today = Math.min(p.dueNow, p.capacityLeftToday);
  if (today < p.dueNow) {
    return `${perTick} per tick — ${today.toLocaleString()} today, the rest tomorrow`;
  }
  const mins = Math.ceil(today / perTick) * TICK_MINUTES;
  return `${perTick} per tick — about ${mins} min to clear`;
}

function etaLabel(days: number | null) {
  if (days === null) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "~1 day";
  return `~${days} days`;
}

export function CampaignProgressCard({ p }: { p: CampaignProgress }) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: p.window.timezone,
  });
  const finishHint =
    p.etaDate === null
      ? p.blockedReason
        ? "stalled"
        : "nothing left to send"
      : `around ${dateFormatter.format(new Date(p.etaDate))}`;

  const shared =
    p.activeCampaigns > 1
      ? ` shared with ${p.activeCampaigns - 1} other active campaign${p.activeCampaigns > 2 ? "s" : ""}`
      : "";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium">
              {p.sent.toLocaleString()} of{" "}
              {(p.sent + p.remaining).toLocaleString()} emails sent
            </span>
            <span className="tabular-nums text-muted-foreground">
              {p.percentComplete}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${p.percentComplete}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile
            label="Left to send"
            value={p.remaining.toLocaleString()}
            hint={
              p.notStarted > 0
                ? `${p.notStarted.toLocaleString()} not started`
                : "all first touches out"
            }
          />
          <Tile
            label="Sent today"
            value={p.sentToday.toLocaleString()}
            hint={
              p.window.open
                ? `${p.capacityLeftToday.toLocaleString()} of today's capacity left`
                : "sending window closed"
            }
          />
          <Tile
            label="Due now"
            value={p.dueNow.toLocaleString()}
            hint={dueHint(p)}
          />
          <Tile
            label="Est. finish"
            value={etaLabel(p.etaDays)}
            hint={finishHint}
          />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Capacity is about {p.capacityPerDay.toLocaleString()} emails a day
          across {p.eligibleAccounts} connected account
          {p.eligibleAccounts === 1 ? "" : "s"}
          {shared}, sending between {hhmm(p.window.start)} and{" "}
          {hhmm(p.window.end)} {p.window.timezone.replace("_", " ")}. The
          estimate assumes your caps, accounts and sending window stay as they
          are, and it will tend to run early, because replies and bounces
          cancel the steps a contact had left.
        </p>

        {p.blockedReason && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {p.blockedReason}
          </p>
        )}

        {p.oooPaused > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {p.oooPaused} enrollment{p.oooPaused === 1 ? " is" : "s are"} OOO-paused
            and not counted above — nothing currently moves them back to active.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
