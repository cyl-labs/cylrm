"use client";

import * as React from "react";
import { LogOut, Menu } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The sidebar, as a drawer, for viewports too narrow to give it 232px
 * permanently — below `lg` it would eat well over half a phone screen.
 *
 * The trigger lives in the page header rather than a bar of its own so a
 * phone still gets one header, not two.
 */
export function MobileNav({
  role,
  keypad = false,
  texting = false,
  unreadReplies = 0,
  callbacksDue = 0,
  missedCalls = 0,
  meetingsWaiting = 0,
  unreadTexts = 0,
}: {
  /** Decides which screens the drawer offers — a caller has no Admin. */
  role: "admin" | "caller" | undefined;
  /** Granted the Keypad. Admins always are. */
  keypad?: boolean;
  texting?: boolean;
  unreadReplies?: number;
  callbacksDue?: number;
  missedCalls?: number;
  meetingsWaiting?: number;
  unreadTexts?: number;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="relative -ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" strokeWidth={1.8} />
        {/* With the nav closed the badge inside it is invisible, so the
            trigger carries the fact that something is waiting. */}
        {(unreadReplies > 0 ||
          unreadTexts > 0 ||
          callbacksDue > 0 ||
          meetingsWaiting > 0 ||
          missedCalls > 0) && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 size-2 rounded-full",
              callbacksDue > 0 || meetingsWaiting > 0 || missedCalls > 0
                ? "bg-destructive"
                : "bg-primary",
            )}
          />
        )}
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[268px] gap-0 bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {/* Clears the sheet's own close button, top right. */}
        <div className="pt-14" />
        {/* Navigating is the whole point of opening this, and the drawer
            covers the page it just moved to. Closing on click beats watching
            the pathname, which needs a state-setting effect. */}
        {/* Scrolls on its own so Dark mode and Log out stay pinned below it:
            on a phone the full list ran off the bottom of the screen. Only a
            link closes the drawer; opening a group must leave it open. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <NavLinks
            grouped
            role={role}
            keypad={keypad}
            texting={texting}
            unreadReplies={unreadReplies}
            callbacksDue={callbacksDue}
            missedCalls={missedCalls}
            meetingsWaiting={meetingsWaiting}
            unreadTexts={unreadTexts}
          />
        </div>
        <div className="mt-auto px-2.5 pb-3.5">
          <ThemeToggle />
          <form method="post" action="/api/logout">
            <button
              type="submit"
              className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-[17px]" strokeWidth={1.8} />
              Log out
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
