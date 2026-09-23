"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

/**
 * The desktop sidebar, folded down to its icons or open to full width.
 *
 * Everything inside hides its words through the `group/sidebar` variant on
 * `data-collapsed`, rather than being told the state as a prop: the links and
 * the footer are rendered by the server layout, and CSS reaches them without
 * turning them all into client components.
 */
export function Sidebar({
  defaultCollapsed,
  children,
}: {
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-150 lg:flex",
        collapsed ? "w-16" : "w-[232px]",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 px-2.5 pb-2 pt-3.5",
          collapsed ? "justify-center" : "justify-end",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Show the menu" : "Hide the menu"}
          title={collapsed ? "Show the menu" : "Hide the menu"}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" strokeWidth={1.8} />
          ) : (
            <PanelLeftClose className="size-[18px]" strokeWidth={1.8} />
          )}
        </button>
      </div>
      {children}
    </aside>
  );
}
