"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Inbox,
  Kanban,
  MailOpen,
  PhoneCall,
  Send,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Email and calling are separate systems that happen to share a login: no
 * lead, list or outcome crosses between them. The sidebar says so out loud
 * rather than mixing the two into one flat list.
 */
const sections = [
  {
    label: "Email",
    links: [
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/campaigns", label: "Campaigns", icon: Send },
      { href: "/accounts", label: "Accounts", icon: Inbox },
      { href: "/replies", label: "Replies", icon: MailOpen },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/stats", label: "Stats", icon: BarChart3 },
    ],
  },
  {
    label: "Calling",
    links: [{ href: "/calls", label: "Call lists", icon: PhoneCall }],
  },
];

export function NavLinks({ unreadReplies = 0 }: { unreadReplies?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5 px-2.5">
          <span className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground/80">
            {section.label}
          </span>
          {section.links.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex h-[38px] items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active &&
                    "bg-primary/10 font-bold text-primary hover:bg-primary/10 hover:text-primary",
                )}
              >
                <Icon className="size-[17px]" strokeWidth={1.8} />
                {label}
                {href === "/replies" && unreadReplies > 0 && (
                  <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-primary-foreground">
                    {unreadReplies > 99 ? "99+" : unreadReplies}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
