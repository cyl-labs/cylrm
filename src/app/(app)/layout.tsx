import { LogOut } from "lucide-react";
import { cookies } from "next/headers";
import { countUnreadReplies } from "@/lib/replies";
import { countCallbacksDue, getSavedLines } from "@/lib/calls";
import { countMissedCalls } from "@/lib/inbound";
import { countMeetingsWaitingFor } from "@/lib/meetings";
import { callScope, getCurrentUser, isSwitchedOff } from "@/lib/session";
import { smsEnabled } from "@/lib/sms";
import { countUnreadTexts } from "@/lib/texts";
import { canUseKeypad, dialMethodOf } from "@/lib/users";
import { LinePresence } from "@/components/calls/line-presence";
import { InboundListener } from "@/components/calls/inbound-listener";
import { CallLineProvider } from "@/components/calls/call-line";
import { TabSync } from "@/components/tab-sync";
import { CalBookingProvider } from "@/components/calls/book-demo";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NavLinks } from "@/components/nav-links";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/components/sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { AppThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();

  // Switched off since they last signed in. `getCurrentUser` has already
  // returned null, so every query below would come back empty and every route
  // 401 — the access is gone either way. This exists so what they see says so,
  // rather than an app with nothing in it, which reads as a fault worth
  // ringing somebody about.
  //
  // Not a redirect to /login: the middleware bounces anyone carrying a session
  // off that page, so it would loop. Clearing the cookie is the way out, and
  // that is the POST below.
  if (!me && (await isSwitchedOff())) {
    return (
      <AppThemeProvider>
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center">
          <h1 className="text-base font-extrabold tracking-[-0.01em]">
            This account has been switched off
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Your access to the CRM has ended. If you think that is a mistake,
            speak to whoever runs the floor.
          </p>
          <form method="post" action="/api/logout" className="mt-5">
            <button
              type="submit"
              className="h-10 w-full rounded-lg bg-primary text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
      </AppThemeProvider>
    );
  }

  // Callers cannot open Replies, so an unread count would light a badge on
  // the drawer that leads nowhere they are allowed to go.
  const unread = me?.role === "admin" ? await countUnreadReplies() : 0;
  // The reader's own, not the floor's — the same change the missed-calls badge
  // got, and for the same reason: a founder's badge that counts everybody is
  // never zero and so never says "something new for me". `callScope` widens an
  // admin to everything, which is right for the screen and wrong for a badge.
  const callbacks =
    me?.role === "admin"
      ? // Their own promised follow-ups, wherever the lead sits. A founder owns
        // barely any lists, and after a demo the callback they agreed lands on
        // the caller's niche — so "lists I own" would show them nothing.
        await countCallbacksDue(undefined, me.id)
      : await countCallbacksDue(callScope(me));
  // Scoped by the number that was rung, not by niche ownership: an inbound
  // call is addressed to a person.
  const missed = await countMissedCalls(me);
  const meetings = await countMeetingsWaitingFor(me);
  // Zero, without touching the table, while texting is switched off.
  const unreadTexts = await countUnreadTexts(me);
  const keypad = await canUseKeypad(me?.id, me?.role);

  // Whether this person can be rung back at all: they need a number of their
  // own, and they need to be dialling in the browser rather than from a
  // handset. Without both there is nothing for a prospect to reach.
  const [row] = (await db.execute(
    sql`select telnyx_did from app_user where id = ${me?.id ?? -1}`,
  )) as { telnyx_did: string | null }[];
  const reachable =
    Boolean(row?.telnyx_did?.trim()) && (await dialMethodOf(me?.id)) === "browser";

  return (
    <AppThemeProvider>
    <LinePresence>
    {/* The phone lives here, above every screen, because a page unmounts on
        navigation and a layout does not — which is why a call used to die the
        moment somebody left the dialler. `reachable` is the whole condition:
        a browser dialler with a number of their own. */}
    <CallLineProvider enabled={reachable}>
    <div className="flex min-h-svh">
      {/* Below `lg` this is a drawer instead — see `MobileNav`, whose trigger
          sits in the page header. */}
      <Sidebar
        defaultCollapsed={
          (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed"
        }
      >
        {/* Every link shows, with no folds. The desktop sidebar folded Tools,
            Results and Admin for a day (2026-09-23) and the founders asked for
            them back: opening a fold on every visit cost more than the length
            ever did. Hiding the whole sidebar is the answer to crowding now.
            Scrolls on its own so the footer stays on a short laptop screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks
            role={me?.role}
            keypad={keypad}
            texting={smsEnabled()}
            unreadReplies={unread}
            callbacksDue={callbacks}
            missedCalls={missed}
            meetingsWaiting={meetings}
            unreadTexts={unreadTexts}
          />
        </div>
        <div className="shrink-0 px-2.5 pb-3.5">
          {/* Who you are, above the way out. The floor shares machines, and
              logging a morning of calls under a colleague's name is only
              noticed once the stats are wrong. */}
          {me && (
            <p className="truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-sidebar-foreground/55 group-data-[collapsed=true]/sidebar:hidden dark:text-sidebar-foreground/75">
              {me.name}
            </p>
          )}
          <ThemeToggle />
          <form method="post" action="/api/logout">
            <button
              type="submit"
              title="Log out"
              className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsed=true]/sidebar:justify-center"
            >
              <LogOut className="size-[17px] shrink-0" strokeWidth={1.8} />
              <span className="group-data-[collapsed=true]/sidebar:hidden">Log out</span>
            </button>
          </form>
        </div>
      </Sidebar>
      {/* The Cal.com booking link, for the booking step on every screen that
          can log a demo: a server env value handed to client components once,
          here, rather than threaded through each page. */}
      <main className="min-w-0 flex-1 bg-background">
        <CalBookingProvider url={process.env.CAL_BOOKING_URL ?? null}>
          {children}
        </CalBookingProvider>
      </main>
      <Toaster />
      {/* A change saved in one CRM tab refreshes the others — the badges and
          lists are server-rendered and otherwise wait for a reload. */}
      <TabSync />
      {/* Draws the call on every screen that is not a calling screen: a
          prospect ringing back, and a call still in progress after somebody
          has navigated away from the dial card. */}
      {/* The saved lines and the number to dial them from, so the agent can be
          conferenced in from any screen and not only the three that render a
          dial card. `getSavedLines` is one small indexed read of `call_number`
          and is `cache`d, so it does not break the rule about queries that
          render with every page. */}
      {reachable && (
        <InboundListener
          savedLines={await getSavedLines()}
          dialFrom={row?.telnyx_did ?? null}
        />
      )}
    </div>
    </CallLineProvider>
    </LinePresence>
    </AppThemeProvider>
  );
}
