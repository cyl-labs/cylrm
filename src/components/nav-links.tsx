"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Inbox,
  Kanban,
  Send,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/accounts", label: "Accounts", icon: Inbox },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/stats", label: "Stats", icon: BarChart3 },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px px-2">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-4 text-muted-foreground",
                active && "text-sidebar-accent-foreground",
              )}
              strokeWidth={1.75}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
