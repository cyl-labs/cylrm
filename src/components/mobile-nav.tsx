"use client";

import * as React from "react";
import { LogOut, Menu } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
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
  unreadReplies = 0,
  callbacksDue = 0,
}: {
  /** Decides whether the drawer offers the Email CRM at all. */
  role: "admin" | "caller" | undefined;
  /** Granted the Keypad. Admins always are. */
  keypad?: boolean;
  unreadReplies?: number;
  callbacksDue?: number;
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
        {(unreadReplies > 0 || callbacksDue > 0) && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 size-2 rounded-full",
              callbacksDue > 0 ? "bg-destructive" : "bg-primary",
            )}
          />
        )}
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[268px] gap-0 bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {/* Right padding keeps the workspace switcher's chevron clear of the
            sheet's own close button. */}
        <div className="px-3 pb-2 pr-11 pt-[18px]">
          <WorkspaceSwitcher role={role} />
        </div>
        {/* See the note in the desktop sidebar. */}
        <div className="pt-3.5" />
        {/* Navigating is the whole point of opening this, and the drawer
            covers the page it just moved to. Closing on click beats watching
            the pathname, which needs a state-setting effect. */}
        <div onClick={() => setOpen(false)}>
          <NavLinks
            role={role}
            keypad={keypad}
            unreadReplies={unreadReplies}
            callbacksDue={callbacksDue}
          />
        </div>
        <div className="mt-auto px-2.5 pb-3.5">
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
