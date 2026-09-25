"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  { value: "all", label: "Anything happened" },
  { value: "upcoming", label: "Still to come" },
  { value: "unanswered", label: "Not logged yet" },
  { value: "showed_up", label: "Showed up" },
  { value: "no_show", label: "No show" },
  { value: "invalid", label: "Not a real booking" },
  { value: "cancelled", label: "Cancelled" },
];

const CONTRACT_OPTIONS = [
  { value: "all", label: "Any contract" },
  { value: "none", label: "No contract yet" },
  { value: "unsent", label: "Drafted, not sent" },
  { value: "sent", label: "Sent, not signed" },
  { value: "signed", label: "Signed" },
];

export type MeetingFilterValues = {
  q: string;
  caller: string;
  status: string;
  niche: string;
  closer: string;
  contract: string;
};

/**
 * The filters over Meetings, upcoming and history alike (2026-09-25). They
 * were two pickers on the history only; the upcoming list is long enough on a
 * busy week to want the same.
 *
 * Keeps the whole query string rather than rebuilding it, because the zone,
 * the view, the kind chips and the Past toggle all write their own keys and a
 * filter that rebuilt the string would drop them. Each picker hides when it
 * would offer one dead option: a caller has no "Booked by" (every row is
 * theirs), and nobody gets a Closer picker until somebody is one.
 */
export function MeetingFilters({
  values,
  callers,
  niches,
  closers,
  founders,
}: {
  values: MeetingFilterValues;
  /** Who booked the meetings on this screen. Founders only. */
  callers: string[];
  niches: string[];
  /** Closers with a meeting here, for founders. */
  closers: { id: number; name: string }[];
  /** Contracts and closers are a founder's business. */
  founders: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(values.q);

  const go = React.useCallback(
    (key: keyof MeetingFilterValues, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value === "all" || value === "") next.delete(key);
      else next.set(key, value);
      const href = `${pathname}?${next.toString()}`;
      beginNavigation(href);
      router.replace(href, { scroll: false });
    },
    [params, pathname, router],
  );

  // Typing searches after a pause rather than on every key, so a name being
  // typed is one navigation and not nine.
  React.useEffect(() => {
    if (q === values.q) return;
    const t = setTimeout(() => go("q", q.trim()), 350);
    return () => clearTimeout(t);
  }, [q, values.q, go]);

  const active =
    values.q !== "" ||
    ["caller", "status", "niche", "closer", "contract"].some(
      (k) => values[k as keyof MeetingFilterValues] !== "all",
    );

  const picker = (
    key: keyof MeetingFilterValues,
    options: { value: string; label: string }[],
    width: string,
  ) => (
    <Select value={values[key]} onValueChange={(v) => go(key, v)}>
      <SelectTrigger size="sm" className={`w-full ${width}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-52">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a business or name"
          aria-label="Search meetings"
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      {picker("status", STATUS_OPTIONS, "sm:w-44")}
      {callers.length > 0 &&
        picker(
          "caller",
          [{ value: "all", label: "Booked by anyone" }, ...callers.map((c) => ({ value: c, label: `Booked by ${c}` }))],
          "sm:w-44",
        )}
      {niches.length > 1 &&
        picker(
          "niche",
          [{ value: "all", label: "Every niche" }, ...niches.map((n) => ({ value: n, label: n }))],
          "sm:w-44",
        )}
      {founders && closers.length > 0 &&
        picker(
          "closer",
          [
            { value: "all", label: "Anyone closing" },
            { value: "founders", label: "Founders closing" },
            ...closers.map((c) => ({ value: String(c.id), label: `${c.name} closing` })),
          ],
          "sm:w-44",
        )}
      {founders && picker("contract", CONTRACT_OPTIONS, "sm:w-44")}
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            const next = new URLSearchParams(params.toString());
            for (const k of ["q", "caller", "status", "niche", "closer", "contract"]) next.delete(k);
            const href = `${pathname}?${next.toString()}`;
            beginNavigation(href);
            router.replace(href, { scroll: false });
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
