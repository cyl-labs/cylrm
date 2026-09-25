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
import type { CalendarEvent } from "@/components/calls/meetings-calendar";
import { getSavedLines } from "@/lib/calls";
import { calConfigured } from "@/lib/cal";
import { UnbookedDemos } from "@/components/calls/unbooked-demos";
import { getTextsByLead, smsEnabled, type Texting } from "@/lib/sms";
import { classifyPhone } from "@/lib/phone";
import { callScope, getCurrentUser } from "@/lib/session";
import { getMeetingStats } from "@/lib/meeting-stats";
import {
  callerNumberOf,
  callRegionOf,
  canSendTexts,
  dialMethodOf,
  listClosers,
  statsRegionOf,
} from "@/lib/users";
import {
  statsZone,
  isStatsRegion,
  DEFAULT_STATS_REGION,
} from "@/lib/stats-zones";
import { TimezonePicker } from "@/components/calls/timezone-picker";
import { screenRegion } from "@/lib/screen-zone";
import {
  MeetingsCalendar,
  type CalendarSpan,
} from "@/components/calls/meetings-calendar";
import { MeetingsView } from "@/components/calls/meetings-view";
import { MeetingFilters } from "@/components/calls/past-meetings-filters";
import { nicheOf } from "@/lib/niche";

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
    kind?: string;
    q?: string;
    niche?: string;
    closer?: string;
    contract?: string;
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
    kind: rawKind,
    q: rawQ,
    niche: rawNiche,
    closer: rawCloser,
    contract: rawContract,
  } = await searchParams;
  // Which meetings to show (2026-09-24): everything by default, or only demos,
  // only follow-ups, or — for a founder — only their own call backs.
  const kind =
    rawKind === "demo" || rawKind === "follow_up" || rawKind === "call_back"
      ? rawKind
      : "all";

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
  const region = await screenRegion(
    "meetings",
    rawTz,
    async () =>
      (await statsRegionOf(me?.id)) ??
      (await callRegionOf(me?.id)) ??
      DEFAULT_STATS_REGION,
  );
  const zone = statsZone(region);

  const allMeetings = await getMeetings(callScope(me), zone.tz, { past });
  // The filters (2026-09-25), over the upcoming list and the history alike.
  // Options come off the *unfiltered* rows, so picking "Aaron" does not also
  // narrow the list of callers down to just Aaron. Applied here rather than in
  // `getMeetings`: the list is tens of rows, and slicing it several ways should
  // not cost a query per click.
  const isFounder = me?.role === "admin";
  const q = (rawQ ?? "").trim();
  const niche = rawNiche ?? "all";
  const closer = isFounder ? (rawCloser ?? "all") : "all";
  const contract = isFounder ? (rawContract ?? "all") : "all";
  const uniq = (xs: string[]) => Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
  const filterCallers = isFounder
    ? uniq(allMeetings.flatMap((m) => (m.bookedBy ? [m.bookedBy] : [])))
    : [];
  const filterNiches = uniq(allMeetings.flatMap((m) => (m.listName ? [nicheOf(m.listName)] : [])));
  const filterClosers = Array.from(
    new Map(
      allMeetings.flatMap((m) =>
        m.closerUserId !== null && m.closerName
          ? [[m.closerUserId, { id: m.closerUserId, name: m.closerName }] as const]
          : [],
      ),
    ).values(),
  );
  const needle = q.toLowerCase();
  const filtered = allMeetings.filter((m) => {
    if (needle) {
      const hay = [m.company, m.attendeeName, m.attendeeEmail, m.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (caller !== "all" && isFounder && m.bookedBy !== caller) return false;
    if (niche !== "all" && (!m.listName || nicheOf(m.listName) !== niche)) return false;
    if (closer !== "all") {
      if (closer === "founders" ? m.closerUserId !== null : String(m.closerUserId) !== closer)
        return false;
    }
    if (contract !== "all") {
      const cs = m.contracts;
      const ok =
        contract === "none"
          ? cs.length === 0
          : contract === "unsent"
            ? cs.some((c) => !c.sentAt && !c.signedAt)
            : contract === "sent"
              ? cs.some((c) => c.sentAt && !c.signedAt)
              : cs.some((c) => c.signedAt);
      if (!ok) return false;
    }
    if (status === "all") return true;
    if (status === "cancelled") return m.status === "cancelled";
    if (m.status === "cancelled") return false;
    if (status === "upcoming") return !m.started;
    if (status === "unanswered") return m.started && !m.logged;
    return m.attendance === status;
  });
  // The kind filter last, so its chips can count what is left after the rest.
  // A meeting a founder moved to a call back is a call back, not a demo, for
  // as long as the call back is open: it sits at that time, as that.
  const kindOf = (m: (typeof filtered)[number]) =>
    m.callBack ? "call_back" : m.kind;
  const meetings =
    kind === "all" ? filtered : filtered.filter((m) => kindOf(m) === kind);
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
  // Carried the way the zone is — across the view switch, a page turn of the
  // calendar and the step into history — or picking "Follow-ups" and turning
  // the month would quietly show everything again.
  const keepKind = kind === "all" ? "" : `&kind=${kind}`;
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
  // A closer gets the briefs for the meetings handed to them (2026-09-25):
  // the brief is the handover to whoever takes the demo.
  const closerId = me?.role === "closer" ? me.id : null;
  const briefs =
    me?.role === "admin"
      ? Object.fromEntries(await getStoredBriefs(meetings.map((m) => m.id)))
      : closerId !== null
        ? Object.fromEntries(
            await getStoredBriefs(
              meetings.filter((m) => m.closerUserId === closerId).map((m) => m.id),
            ),
          )
        : null;
  const closers = me?.role === "admin" ? await listClosers() : [];
  // The last week at a glance (2026-09-25); the breakdown is on Stats. A
  // caller's is the demos they booked, the same scope Stats gives them.
  const week = past
    ? null
    : (
        await getMeetingStats(
          { kind: "rolling", days: 7, tz: zone.tz },
          undefined,
          me?.role === "admin" ? undefined : (me?.id ?? -1),
        )
      ).totals;

  // On the calendar a meeting moved to a call back sits at the call back's
  // time, as a call back — the same place the list now puts it.
  const calendarEvents: CalendarEvent[] = meetings.map((m) =>
    m.callBack
      ? {
          ...m,
          kind: "founder_call" as const,
          startAt: m.callBack.at,
          endAt: null,
          startingSoon: m.callBack.soon,
        }
      : m,
  );

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
              query={`${keepTz}${keepKind}&span=${span}&on=${anchor}`}
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
                ? `/meetings?view=${view}${keepTz}${keepKind}&span=${span}&on=${anchor}`
                : `/meetings?past=1${keepTz}${keepKind}`
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
          <TimezonePicker region={region} screen="meetings" />
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
            {week && (
              <p className="text-[13px] text-muted-foreground">
                <span className="font-semibold text-foreground">Last 7 days:</span>{" "}
                {week.demos === 0 ? (
                  "no demos yet."
                ) : (
                  <>
                    {week.demos} {week.demos === 1 ? "demo" : "demos"},{" "}
                    <span className="font-semibold text-success">
                      {week.showed} showed up
                    </span>
                    , {week.noShow} no show
                    {week.unlogged > 0 && (
                      <>
                        ,{" "}
                        {/* Straight to them. They leave this queue twelve
                            hours after they start, so the only place left to
                            find one is the history, filtered. */}
                        <Link
                          href={`/meetings?past=1&status=unanswered${keepTz}`}
                          className="font-semibold text-destructive underline underline-offset-2"
                        >
                          {week.unlogged} not logged
                        </Link>
                      </>
                    )}
                    .
                  </>
                )}{" "}
                <Link
                  href={`/call-stats?range=7&tz=${region}#meetings`}
                  className="font-semibold text-primary hover:underline"
                >
                  Day by day on {me?.role === "admin" ? "Stats" : "My stats"}
                </Link>
              </p>
            )}
            {/* Demos logged in the CRM with no Cal.com booking behind them:
                the one thing on this screen that is a job with a deadline. */}
            <UnbookedDemos
              ownerId={callScope(me)}
              showWho={me?.role === "admin"}
              tz={zone.tz}
            />
          </>
        )}
        {/* Show everything, or one kind (2026-09-24, asked for as "let me
            filter between follow up meetings and regular ones and have it show
            both by default"). Links, so the choice is in the address like the
            zone and the view, and survives a page turn and a reload. Each
            chip says how many it holds, so an empty filter is not a surprise.
            A founder's own call backs are a kind of their own. */}
        <MeetingFilters
          values={{ q, caller, status, niche, closer, contract }}
          callers={filterCallers}
          niches={filterNiches}
          closers={filterClosers}
          founders={isFounder}
        />
        {(() => {
          const showCallBacks = me?.role === "admin" && !past;
          const count = (k: string) =>
            filtered.filter((m) => kindOf(m) === k).length;
          const kinds = [
            { id: "all", label: "All", count: filtered.length },
            { id: "demo", label: "Demos", count: count("demo") },
            { id: "follow_up", label: "Follow-ups", count: count("follow_up") },
            ...(showCallBacks
              ? [{ id: "call_back", label: "Call backs", count: count("call_back") }]
              : []),
          ];
          const hrefFor = (k: string) => {
            const q = new URLSearchParams();
            if (past) {
              q.set("past", "1");
              if (caller !== "all") q.set("caller", caller);
              if (status !== "all") q.set("status", status);
            } else {
              q.set("view", view);
              q.set("span", span);
              q.set("on", anchor);
            }
            if (isStatsRegion(rawTz)) q.set("tz", rawTz);
            if (k !== "all") q.set("kind", k);
            return `/meetings?${q.toString()}`;
          };
          return (
            <div
              role="group"
              aria-label="Show"
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="mr-0.5 text-[13px] text-muted-foreground">Show</span>
              {kinds.map((k) => (
                <Link
                  key={k.id}
                  href={hrefFor(k.id)}
                  scroll={false}
                  aria-current={kind === k.id ? "page" : undefined}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                    kind === k.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {k.label}
                  <span className="ml-1.5 font-normal tabular-nums opacity-80">
                    {k.count}
                  </span>
                </Link>
              ))}
            </div>
          );
        })()}
        {/* A filter that leaves nothing says so, with the way back, rather
            than the list's own "no meetings booked", which would be a lie. */}
        {kind !== "all" && meetings.length === 0 && (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
            {kind === "call_back"
              ? "No call backs on your calendar."
              : kind === "demo"
                ? "No demos here."
                : "No follow-ups here."}{" "}
            <Link
              href={`/meetings?${past ? "past=1" : `view=${view}&span=${span}&on=${anchor}`}${keepTz}`}
              scroll={false}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Show everything
            </Link>
          </p>
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
            query={`${keepTz}${keepKind}`}
            forCaller={me?.role !== "admin"}
          />
        )}
        {/* The list is rendered under the calendar rather than instead of it.
            The grid answers "which day", and every job on this screen — ring
            them, log what happened, draft a contract — is on a row, so
            switching view must not take the work away. */}
        {(kind === "all" || meetings.length > 0) && (
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
            me?.role === "admin" || me?.role === "closer"
              ? (process.env.DOCUSEAL_PUBLIC_URL ??
                process.env.DOCUSEAL_URL ??
                "")
              : ""
          }
          past={past}
          closerId={closerId}
          closers={closers}
        />
        )}
      </div>
    </PageShell>
  );
}
