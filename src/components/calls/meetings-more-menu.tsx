"use client";

import Link from "next/link";
import { FileText, History, MoreHorizontal, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICONS = { booked: Sparkles, logged: History, briefing: FileText };

export type MoreItem = {
  icon: keyof typeof ICONS;
  label: string;
  /** One plain line under the name, so nobody has to open it to find out. */
  hint: string;
  href: string;
  current?: boolean;
};

/**
 * The lesser Meetings screens, folded under one button (2026-10-06). The header
 * had grown to nine controls and wrapped onto two lines; these three are looked
 * at now and then rather than every shift, so they live here and the row keeps
 * the ones used all day.
 */
export function MeetingsMoreMenu({ items }: { items: MoreItem[] }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted data-[state=open]:bg-muted"
        aria-label="More meeting screens"
      >
        <MoreHorizontal className="size-3.5" />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          return (
            <DropdownMenuItem key={it.href} asChild>
              <Link
                href={it.href}
                aria-current={it.current ? "page" : undefined}
                className={cn("items-start gap-2 py-2", it.current && "bg-muted")}
              >
                <Icon className="mt-0.5 size-4" />
                <span className="flex flex-col">
                  <span className="font-semibold">{it.label}</span>
                  <span className="text-[12px] text-muted-foreground">{it.hint}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
