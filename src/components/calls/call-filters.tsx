"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

/**
 * Niche (and optionally date range) pickers for the calling screens.
 *
 * Both live in one component because both write the query string: the range
 * select on its own would drop `?list=` every time it fired, silently widening
 * the numbers back to every niche.
 */
export function CallFilters({
  lists,
  listId,
  range,
}: {
  lists: { id: number; name: string }[];
  listId: number | "all";
  /** Omitted on screens with no date range, like the board. */
  range?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { list?: string; range?: string }) {
    const params = new URLSearchParams();
    const list = next.list ?? String(listId);
    const r = next.range ?? range;
    if (list !== "all") params.set("list", list);
    if (r) params.set("range", r);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <>
      <Select value={String(listId)} onValueChange={(v) => go({ list: v })}>
        <SelectTrigger size="sm" className="w-full sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All niches</SelectItem>
          {lists.map((l) => (
            <SelectItem key={l.id} value={String(l.id)}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {range !== undefined && (
        <Select value={range} onValueChange={(v) => go({ range: v })}>
          <SelectTrigger size="sm" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}
