"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { WORKSPACES, workspaceForPath } from "@/lib/workspace";

function Badge({
  initial,
  className,
  size = "trigger",
}: {
  initial: string;
  className?: string;
  size?: "trigger" | "item";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center font-extrabold text-primary-foreground",
        size === "trigger"
          ? "size-7 rounded-lg text-[13px]"
          : "size-6 rounded-md text-[11px]",
        className,
      )}
    >
      {initial}
    </span>
  );
}

/**
 * Picks between the two systems in the app — Email CRM and Call CRM — and the
 * read-only demo workspace.
 *
 * The live workspace is derived from the URL, so switching is a plain link to
 * that system's home screen rather than state to keep in sync. Demo mode is a
 * different axis (it swaps the data source, not the screens), so it sits below
 * a separator and stays a cookie toggle.
 */
export function WorkspaceSwitcher({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  const current = workspaceForPath(pathname);

  const tone: Record<string, string> = {
    email: "bg-primary",
    call: "bg-success",
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <Badge
            initial={demo ? "D" : current.initial}
            className={demo ? "bg-warning" : tone[current.id]}
          />
          <span className="truncate text-[15px] font-extrabold tracking-[-0.01em] text-foreground">
            {demo ? "Demo CRM" : current.name}
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {WORKSPACES.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={w.home} className="flex items-center gap-2.5">
              <Badge initial={w.initial} className={tone[w.id]} size="item" />
              <span className="font-semibold">{w.name}</span>
              {!demo && w.id === current.id && (
                <Check className="ml-auto size-4" />
              )}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={demo ? "/api/demo?on=0" : "/api/demo?on=1"}
            className="flex items-center gap-2.5"
          >
            <Badge initial="D" className="bg-warning" size="item" />
            <span className="font-semibold">Demo CRM</span>
            {demo && <Check className="ml-auto size-4" />}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
