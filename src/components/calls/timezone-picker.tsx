"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
// From `stats-zones`, not `call-stats`: that one imports the Postgres client.
import { STATS_ZONES, type StatsRegion } from "@/lib/stats-zones";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { beginNavigation } from "@/components/navigation-progress";

/**
 * Which clock the calling numbers are read in.
 *
 * The reporting zone was a constant — Eastern, because that is where the floor
 * works — which left anyone reading the screen from Singapore unable to ask
 * "what did we do today" about the day they were actually in. It governs the
 * whole screen: which day a call counts as, what the calendar's cells hold,
 * what "Today" resolves to, and the times in the call log.
 *
 * Two places at once, and deliberately: the choice goes into the URL so a
 * link says what it is showing, and onto the account so the next visit opens
 * the same way. The URL wins when both are set, that being someone saying
 * which zone they mean for *this* look at the screen.
 *
 * It keeps the rest of the query string rather than rebuilding it, the bug
 * `call-filters.tsx` documents at length — the difference being that this one
 * reads the live parameters instead of taking them as props, since it is
 * mounted next to the other filters rather than inside them.
 */
export function TimezonePicker({ region }: { region: StatsRegion }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: string) {
    // Saved first, best effort: a preference that fails to store costs the
    // next page load, and there is nothing useful to say to someone who only
    // wanted to change a clock. The navigation happens either way.
    fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statsRegion: next }),
    }).catch(() => {});

    const q = new URLSearchParams(params.toString());
    q.set("tz", next);
    // A day picked in one zone is a different eight hours in another, but it
    // is still the day that was asked for, so `day`, `range` and `month` are
    // all left exactly as they are.
    beginNavigation(`${pathname}?${q.toString()}`);
    router.replace(`${pathname}?${q.toString()}`);
  }

  return (
    <Select value={region} onValueChange={go}>
      {/* Wider than the `sm:w-36` its neighbours use, because its longest
          option is longer than theirs: "Singapore (SGT)" at 14px needs about
          115px, and w-36 leaves roughly 104 once the padding, the gap and the
          16px chevron are taken out. The shared trigger clamps to one line, so
          the overflow showed up as the closing bracket being sliced off rather
          than as anything obviously broken. w-44 matches the wider selects on
          Call lists and leaves real headroom instead of landing on the edge. */}
      <SelectTrigger size="sm" className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATS_ZONES) as StatsRegion[]).map((r) => (
          <SelectItem key={r} value={r}>
            {/* Both, because neither alone is enough: "SGT" is what the times
                are stamped with and "Singapore" is what a person picking one
                is looking for. */}
            {STATS_ZONES[r].name} ({STATS_ZONES[r].label})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
