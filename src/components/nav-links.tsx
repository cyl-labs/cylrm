"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { workspaceForPath } from "@/lib/workspace";

/**
 * The current workspace's screens, and only those — which workspace that is
 * comes from the URL. Switching between Email CRM and Call CRM is the
 * switcher's job, above.
 */
export function NavLinks({
  unreadReplies = 0,
  callbacksDue = 0,
}: {
  unreadReplies?: number;
  /** Callbacks whose time has passed — the calling side's version of unread. */
  callbacksDue?: number;
}) {
  const pathname = usePathname();
  const workspace = workspaceForPath(pathname);

  return (
    <nav className="flex flex-col gap-0.5 px-2.5">
      {workspace.links.map(({ href, label, icon: Icon }) => {
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
            {href === "/callbacks" && callbacksDue > 0 && (
              <span className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-white">
                {callbacksDue > 99 ? "99+" : callbacksDue}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
