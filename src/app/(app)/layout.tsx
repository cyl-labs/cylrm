import { LogOut } from "lucide-react";
import { countUnreadReplies } from "@/lib/replies";
import { countCallbacksDue } from "@/lib/calls";
import { getCurrentUser } from "@/lib/session";
import { NavLinks } from "@/components/nav-links";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  // Callers cannot open Replies, so an unread count would light a badge on
  // the drawer that leads nowhere they are allowed to go.
  const unread = me?.role === "admin" ? await countUnreadReplies() : 0;
  const callbacks = await countCallbacksDue();
  return (
    <div className="flex min-h-svh">
      {/* Below `lg` this is a drawer instead — see `MobileNav`, whose trigger
          sits in the page header. */}
      <aside className="sticky top-0 hidden h-svh w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="px-3 pb-2 pt-[18px]">
          <WorkspaceSwitcher role={me?.role} />
        </div>
        {/* The switcher above already names the workspace you are in, so a
            "Workspace" label between it and its own screens said it twice. */}
        <div className="pt-3.5" />
        <NavLinks unreadReplies={unread} callbacksDue={callbacks} />
        <div className="mt-auto px-2.5 pb-3.5">
          {/* Who you are, above the way out. The floor shares machines, and
              logging a morning of calls under a colleague's name is only
              noticed once the stats are wrong. */}
          {me && (
            <p className="truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-sidebar-foreground/55">
              {me.name}
            </p>
          )}
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
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
      <Toaster />
    </div>
  );
}
