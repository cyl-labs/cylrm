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
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
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
  day,
  maxDay,
}: {
  lists: { id: number; name: string }[];
  listId: number | "all";
  /** Omitted on screens with no date range, like the board. */
  range?: string;
  /** A single Singapore day, YYYY-MM-DD, when one is picked. It replaces the
   *  range rather than narrowing it, so only one of the two is ever set. */
  day?: string;
  /** Today in Singapore — no point offering tomorrow. */
  maxDay?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { list?: string; range?: string; day?: string | null }) {
    const params = new URLSearchParams();
    const list = next.list ?? String(listId);
    if (list !== "all") params.set("list", list);

    // A day and a range are the same question answered two ways, so setting
    // one clears the other.
    const nextDay = next.day === undefined ? day : next.day;
    if (next.range) params.set("range", next.range);
    else if (nextDay) params.set("day", nextDay);
    else if (range) params.set("range", range);

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
        <>
          <Select
            value={day ? "day" : range}
            onValueChange={(v) => go({ range: v, day: null })}
          >
            <SelectTrigger size="sm" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              {/* Only present while a day is picked, so the trigger has
                  something to show for it rather than falling back to a range
                  that is not in force. */}
              {day && (
                <SelectItem value="day">On {day}</SelectItem>
              )}
            </SelectContent>
          </Select>
          {/* Any single day, for the ones the shortcuts and the chart do not
              cover. Native, so a phone gets its own date wheel. */}
          <input
            type="date"
            aria-label="A specific day"
            value={day ?? ""}
            max={maxDay}
            onChange={(e) =>
              go({ day: e.target.value || null, range: e.target.value ? undefined : "7" })
            }
            className="h-8 rounded-md border bg-transparent px-2 text-[13px] shadow-xs"
          />
        </>
      )}
    </>
  );
}
