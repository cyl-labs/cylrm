import { countUnreadReplies } from "@/lib/replies";
import { countCallbacksDue } from "@/lib/calls";
import { countMissedCalls } from "@/lib/inbound";
import { countMeetingsToChaseFor } from "@/lib/meetings";
import { callScope, getCurrentUser } from "@/lib/session";
import { MobileNav } from "@/components/mobile-nav";
import { QuotaBar } from "@/components/calls/quota-bar";
import { getWeekProgress } from "@/lib/call-stats";
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
  // Callers cannot open Replies, so an unread count would light a badge on
  // the drawer that leads nowhere they are allowed to go.
  const unread = me?.role === "admin" ? await countUnreadReplies() : 0;
  const callbacks = await countCallbacksDue(callScope(me));
  // Scoped by the number that was rung, not by niche ownership: an inbound
  // call is addressed to a person.
  const missed = await countMissedCalls(me);
  const meetings = await countMeetingsToChaseFor(me);
  // Callers only: the founders set the quota rather than owing it, the same
  // reason they are off the Scoreboard and off the payroll confirm list. A
  // caller can only ever be on a Call CRM screen, so there is no workspace to
  // check as well as the role.
  const week =
    me?.role === "caller" ? await getWeekProgress(me.id) : null;
  return (
    <div className="flex h-svh flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 gap-y-2 border-b bg-card px-4 py-2.5 sm:px-7">
        <MobileNav
        role={me?.role}
        keypad={await canUseKeypad(me?.id, me?.role)}
        unreadReplies={unread}
        callbacksDue={callbacks}
        missedCalls={missed}
        meetingsToChase={meetings}
      />
        <h1 className="text-lg font-extrabold tracking-[-0.02em] sm:text-xl">
          {title}
        </h1>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {week && <QuotaBar calls={week.calls} />}
      {/* `relative` makes this the containing block for absolutely positioned
          descendants. Without it, `sr-only` spans (position: absolute, no
          positioned ancestor) resolve against the viewport instead, escape the
          overflow clip, and give tall pages a second window-level scrollbar
          into empty space. */}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
