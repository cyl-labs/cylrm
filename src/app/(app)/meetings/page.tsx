import Link from "next/link";
import { FileText, History } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { MeetingsList } from "@/components/calls/meetings-list";
import { MeetingsExplainer } from "@/components/calls/meetings-explainer";
import { PushToggle } from "@/components/calls/push-toggle";
import { RefreshMeetings } from "@/components/calls/refresh-meetings";
import { SyncOnReturn } from "@/components/calls/sync-on-return";
import { PushGate } from "@/components/calls/push-gate";
import { getMeetings } from "@/lib/meetings";
import { getStoredBriefs } from "@/lib/meeting-brief";
import { getFounderCalls } from "@/lib/founder-calls";
import { FounderCallList } from "@/components/calls/founder-calls";
import type { CalendarEvent } from "@/components/calls/meetings-calendar";
import { getSavedLines } from "@/lib/calls";
import { calConfigured } from "@/lib/cal";
import { UnbookedDemos } from "@/components/calls/unbooked-demos";
import { getTextsByLead, smsEnabled, type Texting } from "@/lib/sms";
import { classifyPhone } from "@/lib/phone";
import { callScope, getCurrentUser } from "@/lib/session";
import {
  callerNumberOf,
  callRegionOf,
  canSendTexts,
  dialMethodOf,
  statsRegionOf,
} from "@/lib/users";
import {
  statsZone,
  isStatsRegion,
  DEFAULT_STATS_REGION,
} from "@/lib/stats-zones";
import { TimezonePicker } from "@/components/calls/timezone-picker";
import {
  MeetingsCalendar,
  type CalendarSpan,
} from "@/components/calls/meetings-calendar";
import { MeetingsView } from "@/components/calls/meetings-view";
import { PastMeetingsFilters } from "@/components/calls/past-meetings-filters";

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
export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tz?: string;
    view?: string;
    month?: string;
    span?: string;
    on?: string;
    past?: string;
    caller?: string;
    status?: string;
  }>;
}) {
  const me = await getCurrentUser();
  const {
    tz: rawTz,
    view: rawView,
    month: rawMonth,
    span: rawSpan,
    on: rawOn,
    past: rawPast,
    caller: rawCaller,
    status: rawStatus,
  } = await searchParams;

  // The full history instead of the rolling work queue, off its own button
  // rather than a fold on the usual list — asked for 2026-09-23 after a
  // no-show fell out of the seven-day ring-back window and the only place
  // left to find it was the call log, filtered by outcome, which does not
  // say a call was a no-show rather than a follow-up. See `getMeetings`.
  const past = rawPast === "1";
  // Both meaningless outside history — the work queue is already narrowed to
  // what is owed, and this reader's own list at that. Defaulted to "all"
  // rather than left undefined so a stale link (someone filtered, then came
  // back tomorrow with the same URL) still means something rather than
  // silently widening back to everything.
  const caller = rawCaller ?? "all";
  const status = rawStatus ?? "all";

  // Their own clock: the zone in the link if there is one, else the reporting
  // zone they picked, else the market they work, else Eastern — the same order
  // Stats resolves it in, so the two screens cannot disagree about what day a
  // thing is on, and a link shows its sender what they were looking at.
  //
  // The picker earns its place here for a reason Stats does not have: a
  // meeting is agreed in the prospect's zone and kept in the caller's, and
  // those are rarely the same country. Someone in Singapore reading "2:00 PM
  // ET" has to do the arithmetic themselves at exactly the moment it matters.
  const region = isStatsRegion(rawTz)
    ? rawTz
    : ((await statsRegionOf(me?.id)) ??
      (await callRegionOf(me?.id)) ??
      DEFAULT_STATS_REGION);
  const zone = statsZone(region);

  const allMeetings = await getMeetings(callScope(me), zone.tz, { past });
  // Who booked each of them, for the caller picker — off the *unfiltered*
  // history, so picking "Aaron" does not also narrow the list of callers
  // down to just Aaron. Admin-only like the name itself is everywhere else on
  // this screen (`showWho`): a caller's own past is already scoped to their
  // own list by `callScope`, so there is at most one name in it.
  const pastCallers =
    past && me?.role === "admin"
      ? Array.from(
          new Set(
            allMeetings.flatMap((m) => (m.bookedBy ? [m.bookedBy] : [])),
          ),
        ).sort((a, b) => a.localeCompare(b))
      : [];
  // "What happened" rather than the raw `attendance`/`status` columns — see
  // `PastMeetingsFilters`. Applied here rather than in `getMeetings` because
  // the whole point is slicing a small, already-fetched history several
  // different ways without a round trip per click.
  const meetings =
    past && (caller !== "all" || status !== "all")
      ? allMeetings.filter((m) => {
          if (caller !== "all" && m.bookedBy !== caller) return false;
          if (status === "all") return true;
          if (status === "cancelled") return m.status === "cancelled";
          if (status === "unanswered")
            return m.attendance === null && m.status !== "cancelled";
          return m.attendance === status;
        })
      : allMeetings;
  // Read once: it decides both the mergeable lines and whether this tab takes
  // the phone.
  const browserDialler = (await dialMethodOf(me?.id)) === "browser";

  // The calendar unless the list alone was asked for (2026-09-19, at the
  // founders' request). It shipped the other way round the day before, and the
  // grid turned out to be what people open this screen to see — the list is
  // still under it, so defaulting here takes nothing away, it only adds the
  // shape of the week above the work.
  const view = rawView === "list" ? "list" : "calendar";
  // Day, week or month, and the date the range is built around. Both live in
  // the URL rather than in the browser, so the screen is the same server
  // render either way and a pasted link opens on what its sender saw.
  const span: CalendarSpan =
    rawSpan === "day" || rawSpan === "week" || rawSpan === "next24"
      ? rawSpan
      : "month";
  // Today and the opening range on the reader's own clock, not the droplet's
  // UTC — a demo at 8am Singapore is Friday in New York, and each of them is
  // right about their own Friday.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // The same instant the line above was formatted from, handed to the calendar
  // so the rolling "next 24 hours" window and "today" cannot disagree — and so
  // nothing reads the clock while rendering.
  const now = new Date().toISOString();
  // `on` is the one anchor for all three dated spans. `month=YYYY-MM` is still read
  // so links sent before this keep working, and means the first of that month.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(rawOn ?? "")
    ? (rawOn as string)
    : /^\d{4}-\d{2}$/.test(rawMonth ?? "")
      ? `${rawMonth}-01`
      : today;
  // What to carry across a view switch or a page turn. Written out rather than
  // rebuilt from `searchParams`, since only the zone ever belongs in it.
  const keepTz = isStatsRegion(rawTz) ? `&tz=${rawTz}` : "";
  // The database's clock decided this, not this render's.
  const soon = meetings.filter((m) => m.startingSoon).length;
  const ringBack = meetings.filter((m) => m.needsRingBack).length;
  const cancelled = meetings.filter((m) => m.status === "cancelled").length;
  const noShows = meetings.filter((m) => m.attendance === "no_show").length;

  // Texting the prospect: whoever is allowed to send, and only once it is
  // switched on. Null is the whole of how the feature stays invisible — the
  // list draws no button and no thread, and nothing here touches `call_sms`,
  // which may not exist yet. It was `role === "admin"` until texting became a
  // permission an admin can hand out on Team; `canSendTexts` still answers yes
  // for every founder, so nothing changed for them.
  // The brief already written for each meeting, for the Briefing fold on its
  // row. Founders only, like the Briefing page and the route that writes them.
  // One query for the whole list, never one per row.
  const briefs =
    me?.role === "admin"
      ? Object.fromEntries(await getStoredBriefs(meetings.map((m) => m.id)))
      : null;

  // The founders' own call backs (2026-09-24): set from the no-show pop-up,
  // shown only to founders, and never on the history view.
  const founderCalls =
    me?.role === "admin" && !past ? await getFounderCalls() : [];
  const founderCallsByMeeting = Object.fromEntries(
    founderCalls.flatMap((c) =>
      c.meetingId === null ? [] : [[c.meetingId, { id: c.id, startAt: c.startAt }]],
    ),
  );
  // On the calendar beside the bookings, as their own kind of event.
  const calendarEvents: CalendarEvent[] = [
    ...meetings,
    ...founderCalls.map((c) => ({
      id: c.id,
      kind: "founder_call" as const,
      startAt: c.startAt,
      endAt: null,
      status: "accepted",
      company: c.name,
      attendeeName: null,
      startingSoon: c.soon,
    })),
  ];

  let texting: Texting | null = null;
  if (me && smsEnabled() && (await canSendTexts(me.id, me.role))) {
    const did = await callerNumberOf(me.id);
    texting = {
      byLead: await getTextsByLead(
        meetings.flatMap((m) => (m.leadId === null ? [] : [m.leadId])),
        // The same scope the meetings themselves were read with, so a caller
        // granted texting sees their own thread with the prospect and not a
        // founder's.
        callScope(me),
      ),
      from: did && classifyPhone(did) === "us" ? did : null,
    };
  }

  return (
    <PageShell
      title="Meetings"
      actions={
        <>
          {/* Refresh first: it is the one people reach for, right after
              booking something on Cal.com. */}
          <RefreshMeetings />
          {/* Renders nothing. Watches for a trip to Cal.com and pulls the
              calendar when you come back, so moving a demo does not leave
              this screen counting down to a time nobody agreed to. */}
          <SyncOnReturn />
          {/* Beside Refresh rather than above the list: it changes what the
              page is, so it belongs with the page's controls. Both labels are
              drawn, so nobody has to work out whether the word on the button
              is what they are looking at or what they would get. */}
          {/* Carries the span and the anchor as well as the zone, so a look at
              the list and back returns to the week you were reading rather
              than to this month. The list itself ignores both. Hidden once
              looking at history: a past-only view has no calendar to switch
              to — see the `past` block below. */}
          {!past && (
            <MeetingsView
              view={view}
              query={`${keepTz}&span=${span}&on=${anchor}`}
            />
          )}
          {/* The whole history rather than the rolling queue — every past
              demo, no-show included, not only the ones still owed a ring
              back or a follow-up. Off its own button rather than a fold,
              because it answers a different question than the rest of this
              screen ("what happened", not "what is next") and the two should
              not be scrolled past each other. */}
          <Link
            href={
              past
                ? `/meetings?view=${view}${keepTz}&span=${span}&on=${anchor}`
                : `/meetings?past=1${keepTz}`
            }
            aria-current={past ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors",
              past
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            <History className="size-3.5" />
            {past ? "Upcoming" : "Past meetings"}
          </Link>
          {/* Who booked it and what happened — only meaningful once looking
              at history, where the rows are no longer already narrowed down
              to what is owed. */}
          {past && (
            <PastMeetingsFilters
              callers={pastCallers}
              caller={caller}
              status={status}
            />
          )}
          {/* Every demo's brief in one document, for reading a run of them or
              printing. Each row also carries its own brief in a fold since
              2026-09-24. Founders only, matching the route: writing the briefs
              costs an OpenAI call each and the people who take demos are the
              people who need one. */}
          {me?.role === "admin" && !past && (
            <Link
              href="/meetings/brief"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              <FileText className="size-3.5" />
              Briefing
            </Link>
          )}
          {/* Per browser, not per person — see PushToggle. Renders nothing at
              all where push cannot work, rather than a dead button. */}
          <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
          {/* Last, like it is on Stats: the control you set once and leave,
              rather than one you move through while reading. */}
          <TimezonePicker region={region} />
        </>
      }
    >
      {/* Asked before the list is any use to anybody: the screen only works
          for someone who has been told to look at it. */}
      <PushGate vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
        {/* Above the list rather than at the foot of it: the question it
            answers ("where did all this come from and what do I do?") is asked
            on the way in, and shut by default so it costs one line of height
            to everybody who already knows. Both of these are about the queue,
            not the history, so past mode skips them. */}
        {!past && (
          <>
            <MeetingsExplainer
              zoneName={zone.name}
              isAdmin={me?.role === "admin"}
            />
            {/* Demos logged in the CRM with no Cal.com booking behind them:
                the one thing on this screen that is a job with a deadline. */}
            <UnbookedDemos
              ownerId={callScope(me)}
              showWho={me?.role === "admin"}
              tz={zone.tz}
            />
          </>
        )}
        {meetings.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            {past ? (
              // A count of what happened, not what is owed — the ring-back
              // and follow-up flags this list carries are already shown as
              // badges on the rows themselves.
              <>
                <span className="font-bold">
                  {meetings.length} past meeting
                  {meetings.length === 1 ? "" : "s"}
                </span>
                {noShows > 0 && `, ${noShows} no-show${noShows === 1 ? "" : "s"}`}
                {cancelled > 0 && `, ${cancelled} cancelled`}
              </>
            ) : (
              <>
                {/* Mostly what is coming, not what is owed: nobody rings to
                    confirm any more — a prospect who booked has not
                    forgotten, and asking them to reconfirm only offers them a
                    way out, which is what Cal.com's own reminder emails
                    already cover. The one exception is said first, because
                    it is the only line here that is a job. */}
                {ringBack > 0 && (
                  <>
                    <span className="font-bold text-destructive">
                      {ringBack} to ring back
                    </span>
                    {" · "}
                  </>
                )}
                {soon > 0 ? (
                  <>
                    <span className="font-bold">{soon} within a day</span>
                    {meetings.length > soon &&
                      `, ${meetings.length - soon} further out`}
                  </>
                ) : (
                  `${meetings.length} booked, nothing in the next day`
                )}
                {cancelled > 0 && `, ${cancelled} cancelled`}
              </>
            )}
            {". Times are "}
            {zone.name} time.
          </p>
        )}
        {!past && view === "calendar" && (
          <MeetingsCalendar
            span={span}
            anchor={anchor}
            meetings={calendarEvents}
            tz={zone.tz}
            zoneLabel={zone.label}
            today={today}
            now={now}
            query={keepTz}
            forCaller={me?.role !== "admin"}
          />
        )}
        {/* The list is rendered under the calendar rather than instead of it.
            The grid answers "which day", and every job on this screen — ring
            them, log what happened, draft a contract — is on a row, so
            switching view must not take the work away. */}
        {founderCalls.length > 0 && (
          <FounderCallList
            calls={founderCalls}
            tz={zone.tz}
            zoneLabel={zone.label}
            dialFrom={await callerNumberOf(me?.id)}
            lines={browserDialler ? await getSavedLines() : []}
          />
        )}
        <MeetingsList
          meetings={meetings}
          // The voice agent's own number among them, so the demo can be merged
          // in from the row rather than from the lead's dial card. Empty for a
          // handset caller, who has no browser line to merge onto.
          lines={browserDialler ? await getSavedLines() : []}
          // Claims the phone for this tab while Meetings is open. Without it a
          // second tab sitting on Scripts outranked this one and every row
          // said the phone was elsewhere.
          canDial={browserDialler}
          tz={zone.tz}
          zoneLabel={zone.label}
          showWho={me?.role === "admin"}
          // The demo's own event type, which is what a demo is moved on. Both
          // links are passed because a row is moved on the page it was booked
          // from: a follow-up rescheduled onto the demo link would come back
          // through the sync as a demo, and be asked whether they turned up.
          bookingUrl={process.env.CAL_BOOKING_URL ?? null}
          // The second Cal.com event type, for the call after the demo. Unset
          // means no button rather than one that cannot work.
          followUpBookingUrl={process.env.CAL_FOLLOWUP_URL ?? null}
          texting={texting}
          briefs={briefs}
          founderCalls={me?.role === "admin" ? founderCallsByMeeting : null}
          // Re-sending an invitation needs the Cal.com API, so an account
          // without a key draws no button rather than one that can only fail.
          // Not gated on role: the caller who typed the address wrong is the
          // one who notices, and the route scopes them to their own niches.
          canInvite={calConfigured()}
          // The host a person clicks, which is not the one the server fetches
          // from: in production the API is reached on localhost and the link
          // has to be the public name. Empty hides the contract buttons —
          // which is how the floor is kept out of them entirely. A contract
          // carries the prices, the minimum term and the client's legal name,
          // the same material `procedure-closing-the-demo` is withheld for.
          // The route refuses a caller too; this is only what stops a dead
          // button appearing on a screen they work from.
          signingBase={
            me?.role === "admin"
              ? (process.env.DOCUSEAL_PUBLIC_URL ??
                process.env.DOCUSEAL_URL ??
                "")
              : ""
          }
          past={past}
        />
      </div>
    </PageShell>
  );
}
