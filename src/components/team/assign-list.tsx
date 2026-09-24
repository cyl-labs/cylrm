"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import type { PoolList } from "@/lib/lead-stock";
import { nicheOf } from "@/lib/niche";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MARKET: Record<string, string> = { sg: "Singapore", us: "US", gb: "UK" };

/**
 * Give somebody one of the lists nobody is on.
 *
 * Assigning has always lived on Call lists, one dropdown per card, which is
 * the right place when you are looking at the lists and the wrong one when you
 * are looking at the person: the founders were reading "Aaron has 6 leads
 * left" on Team and then hunting through forty cards on another screen for
 * something to give him. Same route, `PATCH /api/call-lists/[id]`, which is
 * still the only thing that decides whether the change is allowed.
 *
 * **Their own niche is offered first.** A caller working Junk Removal knows
 * the script, the objections and what the businesses sound like; handing them
 * the next part of the same scrape is worth more than a bigger list in a trade
 * they have never rung. Their market comes next, since a US caller cannot work
 * a Singapore list at all — those are shown, last and labelled, rather than
 * hidden, because a founder with nothing else to give should see what exists.
 *
 * Undo rides on the toast rather than a second control on the row: the mistake
 * to catch is the one made ten seconds ago, and anything older is a decision,
 * not a slip.
 */
export function AssignListMenu({
  person,
  pool,
  theirLists,
  market,
  className,
  label = "Give them a list",
}: {
  person: { id: number; name: string };
  pool: PoolList[];
  /** The names of the lists they already work, so the same niche can be
   *  offered first. */
  theirLists: string[];
  /** Their market, so lists they cannot ring sink to the bottom. */
  market: string | null;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function assign(listId: number, listName: string, to: number | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not assign that list.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function give(list: PoolList) {
    if (!(await assign(list.id, list.name, person.id))) return;
    toast.success(`${list.name} is ${person.name}'s`, {
      description: `${list.uncalled.toLocaleString("en-US")} leads nobody has rung.`,
      // Longer than the default four seconds, which is not enough time to
      // read a name, realise it is the wrong one and reach for Undo — and
      // once it is gone the only way back is the other screen.
      duration: 12_000,
      action: {
        label: "Undo",
        onClick: () => {
          void assign(list.id, list.name, null).then(
            (ok) => ok && toast.success(`${list.name} is nobody's again.`),
          );
        },
      },
    });
  }

  const niches = new Set(theirLists.map(nicheOf));
  // Stable buckets rather than one comparator with three tiers in it: the
  // headings below are the buckets, so a sort that produced the same order
  // would still have to be split again to render them.
  const same = pool.filter((l) => niches.has(l.niche));
  const rest = pool.filter((l) => !niches.has(l.niche));
  const theirs = rest.filter((l) => !market || l.region === market);
  const elsewhere = rest.filter((l) => market && l.region !== market);

  const item = (l: PoolList) => (
    <DropdownMenuItem
      key={l.id}
      disabled={saving}
      onSelect={() => void give(l)}
      className="gap-2"
    >
      <span className="truncate font-semibold">{l.name}</span>
      <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">
        {l.total === 0
          ? "empty"
          : l.uncalled === 0
            ? "none new"
            : `${l.uncalled.toLocaleString("en-US")} new`}
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving || pool.length === 0}
          title={
            pool.length === 0
              ? "Every list already belongs to somebody. Import more on Call lists."
              : undefined
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground disabled:opacity-50",
            className,
          )}
        >
          <ListPlus className="size-3" strokeWidth={2.2} />
          {pool.length === 0 ? "Nothing left to give" : label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        {same.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              More of what they already ring
            </DropdownMenuLabel>
            {same.map(item)}
          </>
        )}
        {theirs.length > 0 && (
          <>
            {same.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {market ? `Other ${MARKET[market] ?? market} niches` : "Every other niche"}
            </DropdownMenuLabel>
            {theirs.map(item)}
          </>
        )}
        {elsewhere.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              Another market: they cannot ring these
            </DropdownMenuLabel>
            {elsewhere.map(item)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
