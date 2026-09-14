"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIST_SORTS } from "@/lib/list-sort";
import {
  LIST_STAGES,
  isFiltered,
  listFilterQuery,
  type ListFilters as Filters,
} from "@/lib/list-filter";

const MARKETS: { value: Filters["market"]; label: string }[] = [
  { value: "any", label: "Any market" },
  { value: "us", label: "United States" },
  { value: "sg", label: "Singapore" },
  { value: "gb", label: "United Kingdom" },
  { value: "unfiled", label: "Unfiled" },
];

/**
 * The founders' filter bar on Call lists: search, whose lists, which market,
 * how far along, and the order.
 *
 * One bar rather than controls scattered through the header, which is where
 * the old Mine/Everyone toggle lived; "Mine" is now one of the caller choices.
 * Every control rebuilds the whole query string through `listFilterQuery`, so
 * changing one never quietly clears another. See `lib/list-filter.ts`.
 */
export function ListFilters({
  filters,
  owners,
  canPickMine,
  shown,
  total,
}: {
  filters: Filters;
  /** People who can own a list, plus anybody switched off who still does. */
  owners: { id: number; name: string; active: boolean }[];
  /** The reader has lists of their own to narrow to. */
  canPickMine: boolean;
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const go = (next: Filters) =>
    router.replace(`/calls${listFilterQuery(next)}`, { scroll: false });

  // The search box keeps its own text so typing is instant, and sends it on a
  // short pause rather than on every key, which would re-render the screen
  // once per letter.
  const [text, setText] = React.useState(filters.q);
  const [syncedQ, setSyncedQ] = React.useState(filters.q);
  if (filters.q !== syncedQ) {
    // Cleared or changed from outside (the Clear link, the back button).
    setSyncedQ(filters.q);
    if (filters.q !== text.trim()) setText(filters.q);
  }
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const ownerValue = String(filters.owner);
  const ownerLabel =
    filters.owner === "any"
      ? "Any caller"
      : filters.owner === "me"
        ? "Mine"
        : filters.owner === "none"
          ? "Unassigned"
          : (owners.find((o) => o.id === filters.owner)?.name ?? "Someone who left");

  const filtered = isFiltered(filters);

  return (
    <div className="mb-4 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 [&>*]:w-full sm:[&>*]:w-auto">
        <div className="relative sm:min-w-56 sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ ...filters, q: v.trim() }), 300);
            }}
            placeholder="Search by name, niche or caller"
            aria-label="Search call lists"
            className="h-9 pl-8"
          />
        </div>

        <Select
          value={ownerValue}
          onValueChange={(v) =>
            go({
              ...filters,
              owner: v === "any" || v === "me" || v === "none" ? v : Number(v),
            })
          }
        >
          <SelectTrigger size="sm" className="h-9 sm:w-44" aria-label="Whose lists">
            <SelectValue>{ownerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any caller</SelectItem>
            {canPickMine && <SelectItem value="me">Mine</SelectItem>}
            <SelectItem value="none">Unassigned</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.name}
                {!o.active && (
                  <span className="text-muted-foreground">switched off</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.market}
          onValueChange={(v) => go({ ...filters, market: v as Filters["market"] })}
        >
          <SelectTrigger size="sm" className="h-9 sm:w-40" aria-label="Market">
            <SelectValue>
              {MARKETS.find((m) => m.value === filters.market)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MARKETS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.stage}
          onValueChange={(v) => go({ ...filters, stage: v as Filters["stage"] })}
        >
          <SelectTrigger size="sm" className="h-9 sm:w-40" aria-label="Progress">
            <SelectValue>
              {LIST_STAGES.find((s) => s.value === filters.stage)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LIST_STAGES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.sort}
          onValueChange={(v) => go({ ...filters, sort: v as Filters["sort"] })}
        >
          <SelectTrigger size="sm" className="h-9 sm:w-44" aria-label="Sort call lists">
            <SelectValue>
              {LIST_SORTS.find((s) => s.value === filters.sort)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {LIST_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>
          {filtered ? (
            <>
              Showing <span className="font-semibold text-foreground">{shown}</span>{" "}
              of {total} lists
            </>
          ) : (
            <>
              {total} {total === 1 ? "list" : "lists"}
            </>
          )}
        </span>
        {filtered && (
          <Link
            href={`/calls${listFilterQuery({ ...filters, q: "", owner: "any", market: "any", stage: "all" })}`}
            scroll={false}
            className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-4 hover:underline"
          >
            <X className="size-3.5" />
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}
