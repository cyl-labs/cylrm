import { PageShell } from "@/components/page-shell";
import { MeetingsList } from "@/components/calls/meetings-list";
import { PushToggle } from "@/components/calls/push-toggle";
import { RefreshMeetings } from "@/components/calls/refresh-meetings";
import { getMeetings } from "@/lib/meetings";
import { callScope, getCurrentUser } from "@/lib/session";
import { callRegionOf, statsRegionOf } from "@/lib/users";
import { statsZone } from "@/lib/stats-zones";

export const dynamic = "force-dynamic";

/**
 * Every meeting on the calendar, soonest first.
 *
 * The callbacks diary for booked demos, and built to be read the same way:
 * once at the start of a shift, top to bottom. The SOP now tells callers to
 * open it every day and to ring anything sitting in the top band, which is
 * where the rule actually lives — the screen makes the work visible, the
 * script makes it a habit.
 *
 * Nothing on it is typed by anybody. The times come from Cal.com on the
 * worker's five-minute tick, so a reschedule or a cancellation shows up here
 * without a caller having to notice one and remember to say so.
 */
export default async function MeetingsPage() {
  const me = await getCurrentUser();

  // Their own clock: the reporting zone they picked if they picked one, else
  // the market they work, else Eastern — the same order Stats resolves it in,
  // so the two screens cannot disagree about what day a thing is on.
  const zone = statsZone(
    (await statsRegionOf(me?.id)) ?? (await callRegionOf(me?.id)),
  );

  const meetings = await getMeetings(callScope(me), zone.tz);
  // The database's clock decided this, not this render's.
  const toChase = meetings.filter((m) => m.needsChase).length;
  const cancelled = meetings.filter((m) => m.status === "cancelled").length;

  return (
    <PageShell
      title="Meetings"
      actions={
        <>
          {/* Refresh first: it is the one people reach for, right after
              booking something on Cal.com. */}
          <RefreshMeetings />
          {/* Per browser, not per person — see PushToggle. Renders nothing at
              all where push cannot work, rather than a dead button. */}
          <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
        {meetings.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            {toChase > 0 ? (
              <>
                <span className="font-bold text-destructive">
                  {toChase} to confirm
                </span>
                {meetings.length > toChase &&
                  `, ${meetings.length - toChase} further out`}
              </>
            ) : (
              `${meetings.length} booked, none needing a call yet`
            )}
            {cancelled > 0 && `, ${cancelled} cancelled`}. Times are{" "}
            {zone.name} time.
          </p>
        )}
        <MeetingsList
          meetings={meetings}
          tz={zone.tz}
          zoneLabel={zone.label}
          showWho={me?.role === "admin"}
        />
      </div>
    </PageShell>
  );
}
