"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { beginNavigation } from "@/components/navigation-progress";

/**
 * "What happened" rather than the raw `attendance`/`status` columns, because
 * a history a founder narrows down is asking a question those two columns
 * split across themselves: a meeting can be cancelled with no attendance
 * answer at all, or past its time with nobody having answered yet. Both read
 * as real states worth finding, not as a missing value.
 */
const STATUS_OPTIONS = [
  { value: "all", label: "Every status" },
  { value: "showed_up", label: "Showed up" },
  { value: "no_show", label: "No show" },
  { value: "invalid", label: "Not a real booking" },
  { value: "cancelled", label: "Cancelled" },
  { value: "unanswered", label: "Not answered yet" },
];

/**
 * Narrow the Past meetings history by who booked it and what happened.
 *
 * Keeps the whole query string rather than rebuilding it (`TimezonePicker`'s
 * approach, not `CallFilters`'s) — this sits beside the zone picker and the
 * Past/Upcoming toggle, both of which write their own keys, and a filter that
 * rebuilt the string from scratch would need to know about both to avoid
 * dropping them.
 */
export function PastMeetingsFilters({
  callers,
  caller,
  status,
}: {
  /** Distinct `bookedBy` names among the past meetings, admin-only like the
   *  name itself. Empty hides the picker rather than offering one dead
   *  option. */
  callers: string[];
  caller: string;
  status: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(key: "caller" | "status", value: string) {
    const q = new URLSearchParams(params.toString());
    if (value === "all") q.delete(key);
    else q.set(key, value);
    beginNavigation(`${pathname}?${q.toString()}`);
    router.replace(`${pathname}?${q.toString()}`);
  }

  return (
    <>
      {callers.length > 0 && (
        <Select value={caller} onValueChange={(v) => go("caller", v)}>
          <SelectTrigger size="sm" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every caller</SelectItem>
            {callers.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={status} onValueChange={(v) => go("status", v)}>
        <SelectTrigger size="sm" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
