"use client";

import { usePathname, useRouter } from "next/navigation";
import type { CallOutcome } from "@/lib/calls";
import type { LogFilterValue } from "@/lib/call-stats";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Narrow the call log to one outcome, or to the keypad.
 *
 * Separate from the three filters at the top of the page because it narrows
 * one table rather than the screen: filtering the tiles by outcome would make
 * "60% pickups" mean sixty per cent of the calls that were already pickups.
 * Sitting on the table it affects is what says so without a caption.
 *
 * Takes the other parameters as props and rebuilds the whole query string,
 * the same way `CallFilters` does, so choosing an outcome cannot drop the
 * person or the range that made the list worth reading.
 */
export function LogFilter({
  outcome,
  listId,
  personId,
  range,
  day,
  tz,
}: {
  outcome: LogFilterValue | "all";
  listId: number | "all";
  personId: number | "all";
  range?: string;
  day?: string;
  /** The clock the screen is read in, carried through like everything else
   *  here: narrowing to one outcome must not move the times. */
  tz?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: string) {
    const params = new URLSearchParams();
    if (listId !== "all") params.set("list", String(listId));
    if (personId !== "all") params.set("person", String(personId));
    if (tz) params.set("tz", tz);
    if (day) params.set("day", day);
    else if (range) params.set("range", range);
    if (next !== "all") params.set("outcome", next);

    const query = params.toString();
    // The table is well down the page, so keep the scroll position: jumping
    // back to the top to read a list you were already reading is worse than
    // no filter at all.
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <Select value={outcome} onValueChange={go}>
      <SelectTrigger size="sm" className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All outcomes</SelectItem>
        {(Object.keys(OUTCOME_LABELS) as CallOutcome[]).map((o) => (
          <SelectItem key={o} value={o}>
            {OUTCOME_LABELS[o]}
          </SelectItem>
        ))}
        {/* Last, and after the outcomes rather than among them: it is not one.
            A keypad dial has no outcome at all, which is exactly why it needs
            an entry of its own to be picked out by. */}
        <SelectItem value="keypad">Keypad</SelectItem>
      </SelectContent>
    </Select>
  );
}
