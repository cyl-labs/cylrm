"use client";

import * as React from "react";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import type { LookalikeLead, MatchReason } from "@/lib/same-business";
import { cn } from "@/lib/utils";

/**
 * Suspected copies of one business, each with a tick box.
 *
 * Shared by the importer and the same-business review so the two read alike.
 * Nothing is ticked to begin with: a name match is a guess, and a wrong one
 * hides a real prospect from every caller, so each has to be looked at. "Tick
 * all" is there for the file where every suggestion is plainly right.
 */

export const REASON_LABELS: Record<MatchReason, string> = {
  name: "same name",
  prefix: "same name with more words",
  website: "same website",
};

export type SameBusinessItem = {
  key: string;
  lead: LookalikeLead;
  looksLike: (LookalikeLead & { reason?: MatchReason })[];
  /** Why this one was suggested, when the reason belongs to the row. */
  reason?: MatchReason;
  more?: number;
};

function describe(lead: LookalikeLead) {
  return [lead.phone, lead.where].filter(Boolean).join(" · ");
}

function history(lead: LookalikeLead) {
  if (lead.id === null && lead.list === null) return "earlier in this file";
  const where = lead.list
    ? `on ${lead.list}${lead.owner ? ` (${lead.owner})` : ""}`
    : null;
  const state = lead.lastOutcome
    ? `last call: ${OUTCOME_LABELS[lead.lastOutcome]}`
    : "not rung yet";
  return [where, state].filter(Boolean).join(" · ");
}

export function TickAll({
  keys,
  ticked,
  onChange,
}: {
  keys: string[];
  ticked: string[];
  onChange: (next: string[]) => void;
}) {
  const all = keys.length > 0 && keys.every((k) => ticked.includes(k));
  return (
    <button
      type="button"
      className="shrink-0 text-[12px] font-semibold text-primary hover:underline"
      onClick={() =>
        onChange(
          all
            ? ticked.filter((k) => !keys.includes(k))
            : [...new Set([...ticked, ...keys])],
        )
      }
    >
      {all ? "Untick all" : "Tick all"}
    </button>
  );
}

export function SameBusinessList({
  items,
  ticked,
  onChange,
  offLabel,
  className,
}: {
  items: SameBusinessItem[];
  ticked: string[];
  onChange: (next: string[]) => void;
  /** What an unticked row will be: "Keep as new" on import, "Keep" after. */
  offLabel: string;
  className?: string;
}) {
  const tickedSet = new Set(ticked);
  return (
    <ul className={cn("divide-y", className)}>
      {items.map((item) => {
        const on = tickedSet.has(item.key);
        return (
          <li key={item.key} className="py-2">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={on}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...ticked, item.key]
                      : ticked.filter((k) => k !== item.key),
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold break-words">
                  {item.lead.company || "No business name"}
                </span>
                <span className="block text-[12px] text-muted-foreground">
                  {[
                    describe(item.lead),
                    // A lead already in the CRM says where it is; a row of a
                    // file being imported is not anywhere yet.
                    item.lead.list ? history(item.lead) : null,
                    item.reason ? REASON_LABELS[item.reason] : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {item.looksLike.length > 0 && (
                  <span className="mt-1 block space-y-0.5 border-l-2 pl-2 text-[12px] text-muted-foreground">
                    {item.looksLike.map((l, i) => (
                      <span key={i} className="block break-words">
                        <span className="text-foreground">
                          {i === 0 ? "Looks like " : "and "}
                          {l.company || "a lead with no name"}
                        </span>{" "}
                        · {describe(l)} · {history(l)}
                        {l.reason && ` · ${REASON_LABELS[l.reason]}`}
                      </span>
                    ))}
                    {item.more ? (
                      <span className="block">and {item.more} more</span>
                    ) : null}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  on
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {on ? "Same business" : offLabel}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
