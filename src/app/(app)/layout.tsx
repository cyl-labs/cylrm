import { LogOut } from "lucide-react";
import { isDemoMode } from "@/lib/demo";
import { NavLinks } from "@/components/nav-links";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = await isDemoMode();
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-3 pb-2 pt-[18px]">
          <WorkspaceSwitcher demo={demo} />
        </div>
        <div className="px-[18px] pb-1.5 pt-3.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground/80">
            Workspace
          </span>
        </div>
        <NavLinks />
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
