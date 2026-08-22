"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Four, not six. Yesterday and any other recent day are one tap on the
 *  fortnight chart, which is a better day picker than a list of days. */
const RANGES = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
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
  people,
  personId = "all",
  range,
  day,
}: {
  lists: { id: number; name: string }[];
  listId: number | "all";
  /** Omitted on screens with no per-person view. Only Stats has one. */
  people?: { id: number; name: string }[];
  personId?: number | "all";
  /** Omitted on screens with no date range, like the board. */
  range?: string;
  /** A single Singapore day, YYYY-MM-DD, when one is picked off the chart. It
   *  replaces the range rather than narrowing it, so only one is ever set. */
  day?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: {
    list?: string;
    person?: string;
    range?: string;
    day?: string | null;
  }) {
    const params = new URLSearchParams();
    const list = next.list ?? String(listId);
    if (list !== "all") params.set("list", list);

    // Carried through every change for the same reason the niche is: a person
    // filter that vanished when the range changed would quietly widen the
    // numbers back to the whole floor.
    const person = next.person ?? String(personId);
    if (person !== "all") params.set("person", person);

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

      {people !== undefined && (
        <Select value={String(personId)} onValueChange={(v) => go({ person: v })}>
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {people.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
        </>
      )}
    </>
  );
}
