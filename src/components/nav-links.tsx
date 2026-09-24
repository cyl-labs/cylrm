"use client";

import type { Role } from "@/lib/roles";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  linksFor,
  NAV_GROUPS,
  workspaceForPath,
  type NavGroup,
  type WorkspaceLink,
} from "@/lib/workspace";

/**
 * The current workspace's screens, and only those — which workspace that is
 * comes from the URL. There is no switcher any more (2026-09-23): nobody moves
 * between the two, and the Email CRM's screens are reached by address.
 */
export function NavLinks({
  grouped = false,
  role,
  keypad = false,
  texting = false,
  unreadReplies = 0,
  callbacksDue = 0,
  missedCalls = 0,
  meetingsWaiting = 0,
  unreadTexts = 0,
}: {
  /** Fold the lesser screens under headings — the phone drawer only; the
   *  desktop sidebar shows every link. The day's work — missed calls to
   *  texts — always shows, and the fold holding the page you are on opens by
   *  itself. */
  grouped?: boolean;
  /** Decides which of this workspace's screens are on offer — a caller's has
   *  no Stats. Hiding it is the courtesy; the middleware is the control. */
  role: Role | undefined;
  /** Granted the Keypad. Admins always are. */
  keypad?: boolean;
  /** Texting is switched on, so there is a Texts screen to link to. */
  texting?: boolean;
  unreadReplies?: number;
  /** Callbacks whose time has passed — the calling side's version of unread. */
  callbacksDue?: number;
  missedCalls?: number;
  /** Demos starting within a day, plus no-shows waiting on a ring back. */
  meetingsWaiting?: number;
  /** Texts to this person's own number they have not opened. */
  unreadTexts?: number;
}) {
  const pathname = usePathname();
  const workspace = workspaceForPath(pathname);
  const links = linksFor(workspace, role, keypad, texting);

  // Read once when the drawer opens: it unmounts on close, so the next open
  // starts from whichever page it moved to.
  const [open, setOpen] = React.useState<Set<NavGroup>>(() => {
    const here = links.find((l) => pathname.startsWith(l.href))?.group;
    return new Set(here ? [here] : []);
  });

  /**
   * Where the badge's number actually is.
   *
   * These two badges count only the reader's own — the change asked for on
   * 2026-09-22, so a founder's badge means "something new for me" rather than
   * counting the whole floor and never reaching zero. A founder's screens
   * still default to everyone, so the link has to carry the narrower view or
   * the number you tap and the rows you land on disagree.
   *
   * Nothing changes for a caller: they only ever see their own, and `?who=mine`
   * is ignored for them.
   */
  const hrefFor = (href: string) =>
    role === "admin" && (href === "/missed-calls" || href === "/callbacks")
      ? `${href}?who=mine`
      : href;

  // What each badge counts and its colour. Texts and replies are not red:
  // unread is news, not work owed, and red there would read as one more thing
  // holding up the queue.
  const badges: Record<string, { n: number; red: boolean }> = {
    "/replies": { n: unreadReplies, red: false },
    "/missed-calls": { n: missedCalls, red: true },
    "/callbacks": { n: callbacksDue, red: true },
    "/meetings": { n: meetingsWaiting, red: true },
    "/texts": { n: unreadTexts, red: false },
  };

  // The `group-data-[collapsed=true]/sidebar` variants only match inside the
  // desktop `Sidebar` folded to its icons: the words go, the icon centres, and
  // a badge shrinks to a dot on the icon's corner. The hover title names the
  // screen, since the icon alone is a guess.
  const renderLink = ({ href, label, icon: Icon }: WorkspaceLink) => {
    const active = pathname.startsWith(href);
    const badge = badges[href];
    return (
      <Link
        key={href}
        href={hrefFor(href)}
        title={label}
        className={cn(
          "relative flex h-[38px] items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsed=true]/sidebar:justify-center",
          active &&
            "bg-sidebar-primary/10 font-bold text-sidebar-primary hover:bg-sidebar-primary/10 hover:text-sidebar-primary",
        )}
      >
        <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
        <span className="truncate group-data-[collapsed=true]/sidebar:hidden">{label}</span>
        {badge && badge.n > 0 && (
          <span
            className={cn(
              "ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums",
              "group-data-[collapsed=true]/sidebar:absolute group-data-[collapsed=true]/sidebar:right-1 group-data-[collapsed=true]/sidebar:top-1 group-data-[collapsed=true]/sidebar:size-2 group-data-[collapsed=true]/sidebar:min-w-0 group-data-[collapsed=true]/sidebar:p-0 group-data-[collapsed=true]/sidebar:text-[0px]",
              badge.red ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
            )}
          >
            {badge.n > 99 ? "99+" : badge.n}
          </span>
        )}
      </Link>
    );
  };

  if (!grouped) {
    return <nav className="flex flex-col gap-0.5 px-2.5">{links.map(renderLink)}</nav>;
  }

  const folds = NAV_GROUPS.map((g) => ({
    ...g,
    links: links.filter((l) => l.group === g.id),
  })).filter((g) => g.links.length > 0);

  return (
    <nav className="flex flex-col gap-0.5 px-2.5">
      {links.filter((l) => !l.group).map(renderLink)}
      {folds.length > 0 && <div className="mx-3 my-2 border-t border-sidebar-border" />}
      {folds.map((g) => {
        // A heading over one link is a tap for nothing: a caller's Results
        // holds only My stats.
        if (g.links.length === 1) return renderLink(g.links[0]);
        const isOpen = open.has(g.id);
        return (
          <div key={g.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  return next;
                })
              }
              className="flex h-[38px] items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <ChevronRight
                className={cn("size-[17px] shrink-0 transition-transform", isOpen && "rotate-90")}
                strokeWidth={1.8}
              />
              {g.label}
              {/* What is inside, so a closed fold is not a guess. */}
              {!isOpen && (
                <span className="ml-auto truncate pl-2 text-xs font-normal">
                  {g.links.map((l) => l.label).join(", ")}
                </span>
              )}
            </button>
            {isOpen && <div className="flex flex-col gap-0.5 pl-3">{g.links.map(renderLink)}</div>}
          </div>
        );
      })}
    </nav>
  );
}
