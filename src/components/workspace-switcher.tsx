"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workspaceForPath, workspacesFor } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  email: "bg-primary",
  call: "bg-success",
};

/**
 * Picks the workspace: Email CRM or Call CRM.
 *
 * Which system you are in comes from the URL, never from stored state, so a
 * deep link, the back button and this control cannot disagree — switching is
 * a plain link to that workspace's home.
 */
export function WorkspaceSwitcher({
  role,
}: {
  role: "admin" | "caller" | undefined;
}) {
  const pathname = usePathname();
  const current = workspaceForPath(pathname ?? "/");
  const workspaces = workspacesFor(role);

  // A caller has only the Call CRM, so there is nothing to switch to. A menu
  // with one item that is already ticked invites the question of what else
  // there is — which is exactly what they are not meant to be wondering.
  if (workspaces.length < 2) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-[13px] font-extrabold text-white",
            TONE[current.id],
          )}
        >
          {current.initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold tracking-[-0.01em]">
          {current.name}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-[13px] font-extrabold text-white",
              TONE[current.id],
            )}
          >
            {current.initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-extrabold tracking-[-0.01em]">
            {current.name}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[212px]">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={w.home} className="flex items-center gap-2">
              <span
                className={cn("size-2 shrink-0 rounded-full", TONE[w.id])}
              />
              {w.name}
              {w.id === current.id && (
                <Check className="ml-auto size-3.5 shrink-0" />
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
