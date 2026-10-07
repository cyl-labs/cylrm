import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { getMeetingLog } from "@/lib/meeting-log";
import { getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  showed_up: "Marked as showed up",
  no_show: "Marked as no show",
  invalid: "Marked as not a real booking",
  half_fee: "Marked as half fee",
  undone: "Took an answer back",
  followup_confirmed: "Follow-up: confirmed",
  followup_no_answer: "Follow-up: no answer",
  followup_rescheduled: "Follow-up: rescheduled",
  followup_cancelled: "Follow-up: not rebooking",
  callback_set: "Call back set",
  callback_moved: "Call back moved",
  callback_removed: "Call back removed",
  taken_off: "Taken off Meetings",
};

/**
 * What has been logged on meetings, newest first (2026-10-05).
 *
 * Asked for after a no show was logged on a meeting that had not happened yet
 * and could not be found under Past meetings, which is ordered by when a
 * meeting happened, not by when somebody said something about it. The two are
 * different questions, so this is its own screen rather than a re-sort of Past.
 * Undos are in it because the answer itself is deleted on undo, so the log is
 * the only place left that says it was ever given. Founders only.
 */
export default async function MeetingLogPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/meetings");

  const [entries, zone] = await Promise.all([getMeetingLog(), readerZone(me.id)]);
  const tz = zone.tz;

  // Pinned zone and locale, never the browser's: see AGENTS.md on dates.
  const when = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const slot = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });

  return (
    <PageShell
      title="Recently logged"
      actions={
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" />
          Meetings
        </Link>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-6">
        <p className="text-[13px] text-muted-foreground">
          Everything said about a meeting, newest first: who logged it, when, and
          which meeting it was about. Times are on your clock ({zone.label}). To
          take an answer back, open the meeting under Upcoming or Past meetings
          and choose Undo. To take a call back off, open the meeting, then More,
          then Remove the call back.
        </p>
        {entries.length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-[14px] text-muted-foreground">
            Nothing has been logged yet. Answers, undos and follow-ups on
            meetings will appear here as they happen.
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3">
                <span className="w-28 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {when.format(new Date(e.at))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[14px] font-semibold">
                    {LABEL[e.action] ?? e.action}
                  </span>
                  <span className="text-[14px]">
                    {" "}
                    {e.business ?? "a meeting"}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {[
                      e.who ? `by ${e.who}` : null,
                      e.meetingStartAt
                        ? `meeting at ${slot.format(new Date(e.meetingStartAt))}`
                        : null,
                      e.detail,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
