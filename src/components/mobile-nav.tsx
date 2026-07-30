"use client";

import * as React from "react";
import { LogOut, Menu } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
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
export function MobileNav({ demo }: { demo: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" strokeWidth={1.8} />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[268px] gap-0 bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {/* Right padding keeps the workspace switcher's chevron clear of the
            sheet's own close button. */}
        <div className="px-3 pb-2 pr-11 pt-[18px]">
          <WorkspaceSwitcher demo={demo} />
        </div>
        <div className="px-[18px] pb-1.5 pt-3.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground/80">
            Workspace
          </span>
        </div>
        {/* Navigating is the whole point of opening this, and the drawer
            covers the page it just moved to. Closing on click beats watching
            the pathname, which needs a state-setting effect. */}
        <div onClick={() => setOpen(false)}>
          <NavLinks />
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
