"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Who owns this niche, and the menu to change it.
 *
 * Rendered *over* the card rather than inside it: the whole card is one big
 * link to the dialler, and a dropdown nested in an anchor opens the list and
 * navigates away at the same time.
 */
export function ListAssignment({
  listId,
  assignedName,
  assignedUserId,
  people,
  canManage,
  demo,
}: {
  listId: number;
  assignedName: string | null;
  assignedUserId: number | null;
  people: { id: number; name: string; active: boolean }[];
  canManage: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function assign(userId: number | null, name: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not assign that.");
        return;
      }
      toast.success(name ? `Assigned to ${name}.` : "Unassigned.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const label = assignedName ?? "Unassigned";

  if (!canManage) {
    return (
      <Badge
        variant={assignedName ? "secondary" : "outline"}
        className="shrink-0"
      >
        {label}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving || demo}
          // The card underneath is a link; without this the click reaches it.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
            assignedName
              ? "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70"
              : "text-muted-foreground hover:bg-muted",
            (saving || demo) && "opacity-60",
          )}
        >
          <UserPlus className="size-3" strokeWidth={2.2} />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DropdownMenuLabel>Who works this niche</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {people.map((p) => (
          <DropdownMenuItem
            key={p.id}
            disabled={p.id === assignedUserId}
            onSelect={() => assign(p.id, p.name)}
          >
            {p.name}
            {!p.active && (
              <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                switched off
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={assignedUserId === null}
          onSelect={() => assign(null, null)}
        >
          Nobody in particular
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
