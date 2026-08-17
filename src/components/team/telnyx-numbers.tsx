"use client";

import * as React from "react";
import { PhoneOutgoing } from "lucide-react";
import type { TeamMember } from "@/lib/users";
import { cn } from "@/lib/utils";

/**
 * What numbers the business owns, and who rings from each.
 *
 * Read-only on purpose. Numbers are bought, ported and released in the Telnyx
 * portal; the CRM's job is only to say which person uses which. An earlier
 * version let a number be set per market here as well, which meant the caller
 * ID on a call could come from two places and the screen showed neither.
 *
 * It exists because deleting that left nowhere to see the numbers at all, and
 * "assign one of your numbers" is a hard instruction to follow when the app
 * never says what you have.
 */
const COUNTRY = { SG: "Singapore", US: "US", GB: "UK" } as const;

export function TelnyxNumbers({
  team,
  className,
}: {
  team: TeamMember[];
  className?: string;
}) {
  const [numbers, setNumbers] = React.useState<
    { phoneNumber: string; country: string | null }[] | null
  >(null);

  React.useEffect(() => {
    fetch("/api/call-dids")
      .then((r) => (r.ok ? r.json() : { numbers: [] }))
      .then((d) => setNumbers(d.numbers ?? []))
      .catch(() => setNumbers([]));
  }, []);

  const holder = (n: string) => team.find((t) => t.telnyxDid === n) ?? null;

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-[-0.01em]">
          <PhoneOutgoing className="size-4 text-muted-foreground" strokeWidth={2.2} />
          Your Telnyx numbers
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Buy and release these in the Telnyx portal. Here you only choose who
          rings from which, in the table below.
        </p>
      </div>

      {numbers === null ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
      ) : numbers.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">
          No numbers on the account, or Telnyx could not be reached.
        </p>
      ) : (
        <ul className="divide-y">
          {numbers.map((n) => {
            const who = holder(n.phoneNumber);
            return (
              <li
                key={n.phoneNumber}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
              >
                <span className="font-bold tabular-nums">{n.phoneNumber}</span>
                <span className="text-muted-foreground">
                  {COUNTRY[n.country as keyof typeof COUNTRY] ?? n.country ?? "-"}
                </span>
                <span
                  className={cn(
                    "ml-auto",
                    who ? "font-semibold" : "text-muted-foreground",
                  )}
                >
                  {who ? who.name : "Nobody yet"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
