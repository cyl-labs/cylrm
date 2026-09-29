import { isFloor } from "@/lib/roles";
import { countUnreadReplies } from "@/lib/replies";
import { countCallbacksDue } from "@/lib/calls";
import { countMissedCalls } from "@/lib/inbound";
import { countMeetingsWaitingFor } from "@/lib/meetings";
import { callScope, getCurrentUser } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { countUnreadTexts } from "@/lib/texts";
import { MobileNav } from "@/components/mobile-nav";
import { QuotaBar } from "@/components/calls/quota-bar";
import { getWeekProgress } from "@/lib/call-stats";
import { STATS_TZ } from "@/lib/stats-zones";
import { canUseKeypad } from "@/lib/users";

export async function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  // Asked together: they are independent reads, and awaiting them one after
  // another was nine round trips before the page could start drawing.
  //
  // Callers cannot open Replies, so an unread count would light a badge on the
  // drawer that leads nowhere they are allowed to go. Callbacks are the
  // reader's own for a founder, as in the sidebar (see the layout), so the
  // drawer and the sidebar agree and the two calls share one cached answer.
  // Missed calls are scoped by the number that was rung, not by niche
  // ownership: an inbound call is addressed to a person. The quota is for
  // callers only: the founders set it rather than owing it, the same reason
  // they are off the Scoreboard and off the payroll confirm list. A caller can
  // only ever be on a Call CRM screen, so there is no workspace to check as
  // well as the role.
  const [unread, callbacks, missed, meetings, unreadTexts, week, keypad] =
    await Promise.all([
      me?.role === "admin" ? countUnreadReplies() : 0,
      me?.role === "admin"
        ? countCallbacksDue(undefined, me.id)
        : countCallbacksDue(callScope(me)),
      countMissedCalls(me),
      countMeetingsWaitingFor(me),
      countUnreadTexts(me),
      me && isFloor(me.role) ? getWeekProgress(me.id) : null,
      canUseKeypad(me?.id, me?.role),
    ]);
  return (
    <div className="flex h-svh flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 gap-y-2 border-b bg-card px-4 py-2.5 sm:px-7">
        <MobileNav
        role={me?.role}
        keypad={keypad}
        texting={smsEnabled()}
        unreadReplies={unread}
        callbacksDue={callbacks}
        missedCalls={missed}
        meetingsWaiting={meetings}
        unreadTexts={unreadTexts}
      />
        <h1 className="text-lg font-extrabold tracking-[-0.02em] sm:text-xl">
          {title}
        </h1>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {week && (
        <QuotaBar
          calls={week.calls}
          // Eastern, because that is the clock the quota week is cut in — not
          // the reader's, which would name an hour the reset does not happen
          // at. Formatted here rather than in the bar: the shell is a server
          // component, and a time built in the browser would not match.
          since={new Intl.DateTimeFormat("en-US", {
            timeZone: STATS_TZ,
            weekday: "short",
            hour: "numeric",
            timeZoneName: "short",
          }).format(new Date(week.since))}
        />
      )}
      {/* `relative` makes this the containing block for absolutely positioned
          descendants. Without it, `sr-only` spans (position: absolute, no
          positioned ancestor) resolve against the viewport instead, escape the
          overflow clip, and give tall pages a second window-level scrollbar
          into empty space. */}
      {/* `data-page-body` is what dims while a filter or another page is
          loading — see `NavigationProgress`. */}
      <div data-page-body className="relative min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
