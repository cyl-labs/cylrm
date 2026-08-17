"use client";

import * as React from "react";
import { PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Which number each market dials from.
 *
 * Admin-only, and on the Team screen because that is the only admin-only
 * corner of the Call CRM. Was three environment variables, which made changing
 * a phone number an SSH session and a restart; a number changes when one is
 * bought or ported, which has nothing to do with deploying.
 *
 * The choices come from the Telnyx account rather than a text box, so a
 * mistyped number cannot become the caller ID every prospect sees.
 */
const MARKETS = [
  { key: "sg", label: "Singapore", iso: "SG" },
  { key: "us", label: "US", iso: "US" },
  { key: "gb", label: "UK", iso: "GB" },
] as const;

const NONE = "__none__";

export function CallerIdCard({ className }: { className?: string }) {
  const [dids, setDids] = React.useState<Record<string, string>>({});
  const [numbers, setNumbers] = React.useState<
    { phoneNumber: string; country: string | null }[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/call-dids");
        if (res.ok) {
          const d = await res.json();
          setDids(d.dids ?? {});
          setNumbers(d.numbers ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(region: string, phoneNumber: string) {
    setBusy(region);
    const previous = dids[region];
    setDids((p) => ({ ...p, [region]: phoneNumber }));
    try {
      const res = await fetch("/api/call-dids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save.");
        setDids((p) => ({ ...p, [region]: previous ?? "" }));
        return;
      }
      toast.success(
        phoneNumber
          ? `${MARKETS.find((m) => m.key === region)?.label} calls from ${phoneNumber}`
          : "Caller ID cleared.",
      );
    } catch {
      toast.error("Could not save: network error.");
      setDids((p) => ({ ...p, [region]: previous ?? "" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-[-0.01em]">
          <PhoneOutgoing className="size-4 text-muted-foreground" strokeWidth={2.2} />
          Caller ID by market
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          What a prospect sees when the browser dialler rings them. A market
          with none set cannot be dialled from here, and its leads say so.
        </p>
      </div>
      <div className="divide-y">
        {MARKETS.map((m) => {
          const forMarket = numbers.filter(
            (n) => !n.country || n.country === m.iso,
          );
          const current = dids[m.key] ?? "";
          return (
            <div
              key={m.key}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="w-24 shrink-0 text-[13px] font-semibold">
                {m.label}
              </span>
              <Select
                value={current || NONE}
                disabled={loading || busy === m.key}
                onValueChange={(v) => save(m.key, v === NONE ? "" : v)}
              >
                <SelectTrigger size="sm" className="w-full sm:w-64">
                  <SelectValue placeholder={loading ? "Loading…" : "None set"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None set</SelectItem>
                  {/* A number already chosen but no longer on the account
                      still needs to be selectable, or the box would show blank
                      and look broken. */}
                  {current && !forMarket.some((n) => n.phoneNumber === current) && (
                    <SelectItem value={current}>{current}</SelectItem>
                  )}
                  {forMarket.map((n) => (
                    <SelectItem key={n.phoneNumber} value={n.phoneNumber}>
                      {n.phoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && forMarket.length === 0 && !current && (
                <span className="text-[12px] text-muted-foreground">
                  No {m.label} number on the Telnyx account yet.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
