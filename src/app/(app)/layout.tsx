import { LogOut } from "lucide-react";
import { isDemoMode } from "@/lib/demo";
import { countUnreadReplies } from "@/lib/replies";
import { NavLinks } from "@/components/nav-links";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = await isDemoMode();
  // The demo workspace has no inbox of its own.
  const unread = demo ? 0 : await countUnreadReplies();
  return (
    <div className="flex min-h-svh">
      {/* Below `lg` this is a drawer instead — see `MobileNav`, whose trigger
          sits in the page header. */}
      <aside className="sticky top-0 hidden h-svh w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="px-3 pb-2 pt-[18px]">
          <WorkspaceSwitcher demo={demo} />
        </div>
        {/* NavLinks carries its own "Email" / "Calling" headings, so a
            "Workspace" label above them would be a heading over headings. */}
        <div className="pt-3.5" />
        <NavLinks unreadReplies={unread} />
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
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
      <Toaster />
    </div>
  );
}
