"use client";

import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { WORKSPACES, workspaceForPath } from "@/lib/workspace";

const TONE: Record<string, string> = {
  email: "bg-primary",
  call: "bg-success",
};

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
 * Picks the workspace: Email CRM or Call CRM, live or demo.
 *
 * Which system you are in comes from the URL and whether it is demo data comes
 * from a cookie, so every entry here routes through /api/demo, which sets both
 * in one hop. Navigating without touching the cookie was what made the demo
 * impossible to leave.
 */
export function WorkspaceSwitcher({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  const current = workspaceForPath(pathname);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <Badge
            initial={current.initial}
            className={demo ? "bg-warning" : TONE[current.id]}
          />
          <span className="truncate text-[15px] font-extrabold tracking-[-0.01em] text-foreground">
            {demo ? `Demo ${current.name}` : current.name}
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {WORKSPACES.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <a
              href={`/api/demo?on=0&to=${encodeURIComponent(w.home)}`}
              className="flex items-center gap-2.5"
            >
              <Badge initial={w.initial} className={TONE[w.id]} size="item" />
              <span className="font-semibold">{w.name}</span>
              {!demo && w.id === current.id && (
                <Check className="ml-auto size-4" />
              )}
            </a>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Demo — sample data, read only
        </DropdownMenuLabel>
        {WORKSPACES.map((w) => (
          <DropdownMenuItem key={`demo-${w.id}`} asChild>
            <a
              href={`/api/demo?on=1&to=${encodeURIComponent(w.home)}`}
              className="flex items-center gap-2.5"
            >
              <Badge initial={w.initial} className="bg-warning" size="item" />
              <span className="font-semibold">Demo {w.name}</span>
              {demo && w.id === current.id && (
                <Check className="ml-auto size-4" />
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
