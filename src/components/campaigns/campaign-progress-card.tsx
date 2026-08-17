import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { type CampaignProgress } from "@/lib/campaign-progress";

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

function etaLabel(days: number | null) {
  if (days === null) return "-";
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

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Tile
            label="Left to send"
            value={p.remaining.toLocaleString()}
            hint="emails across every step"
          />
          <Tile
            label="Leads messaged"
            value={p.contactsMessaged.toLocaleString()}
            hint={`of ${p.contactsEnrolled.toLocaleString()} enrolled`}
          />
          <Tile
            label="New leads left"
            value={p.notStarted.toLocaleString()}
            hint={
              p.notStarted > 0
                ? "first touches not sent yet"
                : "every contact has had a first touch"
            }
          />
          <Tile
            label="Second touches left"
            value={p.secondTouchesLeft.toLocaleString()}
            hint={
              p.stepCount < 2
                ? "this campaign has one step"
                : p.secondTouchesLeft > 0
                  ? `${p.notStarted.toLocaleString()} of them wait on a first touch`
                  : "every contact has had a second touch"
            }
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
          cancel the steps a contact had left.{" "}
          {p.dueNow > 0 &&
            `${p.dueNow.toLocaleString()} email${p.dueNow === 1 ? " is" : "s are"} due right now.`}
        </p>

        {p.blockedReason && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {p.blockedReason}
          </p>
        )}

        {p.oooPaused > 0 && (
          <p className="text-xs text-muted-foreground">
            {p.oooPaused} contact{p.oooPaused === 1 ? " replied" : "s replied"} with
            an out-of-office, so {p.oooPaused === 1 ? "their" : "their"} sequence is
            paused for 7 days and resumes automatically. The steps still owed are
            included above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
