import Link from "next/link";
import { showRate, type MeetingStats } from "@/lib/meeting-stats";
import { cn } from "@/lib/utils";

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/**
 * The meetings in the Stats window: what happened at each demo, and what came
 * after (2026-09-25). See `getMeetingStats` for what each number counts.
 *
 * `founders` adds the second half — follow-ups, trials, wins, ring backs.
 * Those are the founders' own work and the commercial end, the same material
 * the closing SOP keeps off the floor; a caller's version is the demos they
 * booked and how those turned out, which is what their attendance pay is on.
 */
export function MeetingStatsCard({
  stats,
  founders,
  zoneName,
  dayHref,
}: {
  stats: MeetingStats;
  founders: boolean;
  zoneName: string;
  /** The Stats link for one day, keeping the screen's other filters. */
  dayHref: (day: string) => string;
}) {
  const t = stats.totals;
  const rate = showRate(t);

  const tiles: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: "Demos",
      value: String(t.demos),
      sub: founders ? "booked for these dates" : "you booked, for these dates",
    },
    {
      label: "Showed up",
      value: String(t.showed),
      sub: "a real conversation",
      tone: "text-success",
    },
    { label: "Voicemail", value: String(t.voicemail), sub: "no show, went to voicemail" },
    { label: "No answer", value: String(t.noAnswer), sub: "no show, nobody picked up" },
    {
      label: "Show rate",
      value: rate === null ? "-" : `${Math.round(rate * 100)}%`,
      sub: "showed up, of those answered",
    },
    {
      label: "Not logged",
      value: String(t.unlogged),
      sub: t.unlogged > 0 ? "started, nobody said what happened" : "every demo answered",
      tone: t.unlogged > 0 ? "text-destructive" : undefined,
    },
  ];
  const after: { label: string; value: number; sub: string }[] = [
    { label: "Follow-up meetings", value: t.followUpMeetings, sub: "on the calendar" },
    { label: "Follow-up calls", value: t.followUpCalls, sub: "logged after a demo" },
    { label: "Trials", value: t.trials, sub: "from a follow-up call" },
    { label: "Won", value: t.won, sub: "from a follow-up call" },
    { label: "Lost", value: t.lost, sub: "from a follow-up call" },
    {
      label: "No-show call backs",
      value: t.ringBacks,
      sub: `${t.ringBackSpoke} spoke, ${t.ringBackRebooked} rebooked`,
    },
  ];

  const cols: { key: keyof MeetingStats["totals"]; label: string }[] = [
    { key: "demos", label: "Demos" },
    { key: "showed", label: "Showed up" },
    { key: "voicemail", label: "Voicemail" },
    { key: "noAnswer", label: "No answer" },
    { key: "notReal", label: "Not real" },
    { key: "unlogged", label: "Not logged" },
    { key: "upcoming", label: "Still to come" },
    { key: "cancelled", label: "Cancelled" },
    ...(founders
      ? ([
          { key: "followUpMeetings", label: "Follow-up mtgs" },
          { key: "followUpCalls", label: "Follow-up calls" },
          { key: "trials", label: "Trials" },
          { key: "won", label: "Won" },
          { key: "lost", label: "Lost" },
          { key: "ringBacks", label: "Call backs" },
        ] as const)
      : []),
  ];

  const empty = stats.days.length === 0;

  return (
    <div id="meetings" className={cn(CARD, "scroll-mt-20")}>
      <div className="border-b border-border/60 px-5 py-3.5">
        <p className="text-sm font-extrabold tracking-[-0.01em]">
          {founders ? "Meetings" : "Your meetings"}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/75">
          Each demo counts on the day it was booked for, {zoneName} time,
          {founders
            ? " and follow-up calls and call backs on the day they were logged."
            : " for the demos you booked."}{" "}
          A no-show is split into voicemail and no answer by what was picked
          when it was logged. Older no-shows only count as voicemail if the
          note said so.
        </p>
      </div>

      {empty ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          No meetings in these dates. Pick a longer range above, or a day on
          the calendar below.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-lg border px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">{x.label}</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]",
                    x.tone,
                  )}
                >
                  {x.value}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/75">{x.sub}</p>
              </div>
            ))}
          </div>
          {founders && (
            <div className="grid grid-cols-2 gap-3 px-5 pt-3 sm:grid-cols-3 lg:grid-cols-6">
              {after.map((x) => (
                <div key={x.label} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-xs font-semibold text-muted-foreground">{x.label}</p>
                  <p className="mt-1 text-xl font-extrabold tabular-nums">{x.value}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/75">{x.sub}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mx-5 my-4 overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2">Day</th>
                  {cols.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.days.map((d) => (
                  <tr key={d.day} className="border-t">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-semibold">
                      <Link href={dayHref(d.day)} className="hover:text-primary hover:underline">
                        {dayLabel(d.day)}
                      </Link>
                    </td>
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-3 py-2 text-right",
                          d[c.key] === 0 && "text-muted-foreground/50",
                          c.key === "unlogged" && d[c.key] > 0 && "font-bold text-destructive",
                        )}
                      >
                        {d[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
