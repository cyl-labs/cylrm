"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_LIST_SORT,
  LIST_SORTS,
  type ListSort,
} from "@/lib/list-sort";

/**
 * How the Call lists screen is ordered.
 *
 * The choice lives in the URL, like the Mine/Everyone filter beside it, so it
 * survives a refresh and a link shows what its sender saw. It rebuilds the
 * whole query string rather than setting one key, carrying `mine` through —
 * the trap Stats documents, where a control that rebuilt only its own
 * parameter quietly dropped the other filter every time it fired.
 */
export function ListSortPicker({
  value,
  mine,
}: {
  value: ListSort;
  /** The Mine/Everyone choice as it is in the URL, or null when absent. */
  mine: "1" | "0" | null;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-muted-foreground">Sort</span>
      <Select
        value={value}
        onValueChange={(next) => {
          const q = new URLSearchParams();
          if (mine) q.set("mine", mine);
          if (next !== DEFAULT_LIST_SORT) q.set("sort", next);
          const qs = q.toString();
          router.replace(qs ? `/calls?${qs}` : "/calls", { scroll: false });
        }}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Sort call lists">
          {/* The label passed in rather than left to the select to find: it
              fills the chosen item's text in only once it has mounted in the
              browser, so the server's HTML showed an empty box until then. */}
          <SelectValue>
            {LIST_SORTS.find((s) => s.value === value)?.label}
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
  );
}
