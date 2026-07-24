import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NavLinks } from "@/components/nav-links";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-muted/30">
        <div className="px-4 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Outreach CRM
          </Link>
        </div>
        <NavLinks />
        <div className="mt-auto p-4">
          <form method="post" action="/api/logout">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Log out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
