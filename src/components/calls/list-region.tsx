"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Folder } from "lucide-react";
import { toast } from "sonner";
import type { CallRegion } from "@/lib/calls";
import { REGION_LABELS, REGION_ORDER, REGION_SHORT } from "@/components/calls/region";
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
 * Which folder a list sits in, and the menu to move it.
 *
 * Admin-only, and rendered nowhere else: a caller sees only their own niches,
 * so grouping them would be folders over three cards.
 *
 * Positioned over the card rather than inside it, like `ListAssignment` beside
 * it — the whole card is one big link, and a dropdown nested in an anchor
 * opens the menu and navigates away at the same time.
 */
export function ListRegion({
  listId,
  region,
}: {
  listId: number;
  region: CallRegion | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function move(next: CallRegion | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Only `region`, never the owner: the route applies each field it is
        // given, so sending both would let this control silently overwrite an
        // assignment made in the menu next to it.
        body: JSON.stringify({ region: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not move that.");
        return;
      }
      toast.success(next ? `Moved to ${REGION_LABELS[next]}.` : "Unfiled.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label="Move to a folder"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
            region
              ? "border-transparent bg-muted text-foreground hover:bg-muted/70"
              : "text-muted-foreground hover:bg-muted",
            saving && "opacity-60",
          )}
        >
          <Folder className="size-3" strokeWidth={2.2} />
          {region ? REGION_SHORT[region] : "Unfiled"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DropdownMenuLabel>Folder</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {REGION_ORDER.map((r) => (
          <DropdownMenuItem
            key={r}
            disabled={r === region}
            onSelect={() => move(r)}
          >
            {REGION_LABELS[r]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={region === null} onSelect={() => move(null)}>
          Unfiled
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
