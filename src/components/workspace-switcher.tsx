"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({ demo }: { demo: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold text-primary-foreground",
              demo ? "bg-warning" : "bg-primary",
            )}
          >
            {demo ? "D" : "O"}
          </span>
          <span className="truncate text-[15px] font-extrabold tracking-[-0.01em] text-foreground">
            {demo ? "Demo CRM" : "cylrm"}
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem asChild>
          <a href="/api/demo?on=0" className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-[11px] font-extrabold text-primary-foreground">
              O
            </span>
            <span className="font-semibold">cylrm</span>
            {!demo && <Check className="ml-auto size-4" />}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/api/demo?on=1" className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-warning text-[11px] font-extrabold text-primary-foreground">
              D
            </span>
            <span className="font-semibold">Demo CRM</span>
            {demo && <Check className="ml-auto size-4" />}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
