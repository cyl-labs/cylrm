import Link from "next/link";
import { LogOut } from "lucide-react";
import { NavLinks } from "@/components/nav-links";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-4 pb-3 pt-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
              O
            </span>
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              Outreach CRM
            </span>
          </Link>
        </div>
        <div className="px-4 pb-1 pt-2">
          <span className="text-xs font-medium text-muted-foreground/80">
            Workspace
          </span>
        </div>
        <NavLinks />
        <div className="mt-auto px-2 pb-3">
          <form method="post" action="/api/logout">
            <button
              type="submit"
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
              Log out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}
