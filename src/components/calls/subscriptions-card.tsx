"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type SubscriptionRow = {
  id: number;
  name: string;
  active: boolean;
  /** What was typed in, e.g. "S$30.00 a month". */
  entered: string;
  /** The monthly cost in the screen's currency. */
  monthly: string;
};

const FIELD =
  "h-9 rounded-md border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * The fixed bills that are not Telnyx: Claude, the Discord, and whatever else
 * renews on a card. Typed in by hand because none of them has anything to read.
 */
export function SubscriptionsCard({ rows }: { rows: SubscriptionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("sgd");
  const [period, setPeriod] = React.useState("month");

  async function call(url: string, init: RequestInit, done?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save.");
        return;
      }
      done?.();
      router.refresh();
    } catch {
      toast.error("Could not save: network error.");
    } finally {
      setBusy(false);
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    void call(
      "/api/subscriptions",
      { method: "POST", body: JSON.stringify({ name, amount, currency, period }) },
      () => {
        setName("");
        setAmount("");
      },
    );
  }

  return (
    <div>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          No subscriptions yet. Add each recurring bill below (Claude, the
          Discord, anything that renews) and it counts towards the total above.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 text-[13px]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className={cn("font-semibold", !r.active && "text-muted-foreground line-through")}>
                {r.name}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {r.entered}
                {!r.active && " · stopped, not counted"}
              </span>
              <span className="ml-auto tabular-nums">
                {r.active ? `${r.monthly} a month` : "-"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call(`/api/subscriptions/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: !r.active }),
                  })
                }
                className="rounded-md border px-2 py-1 text-[12px] font-semibold hover:bg-muted disabled:opacity-60"
              >
                {r.active ? "Stop" : "Restart"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Remove ${r.name}? Use Stop instead to keep it listed.`)) return;
                  void call(`/api/subscriptions/${r.id}`, { method: "DELETE" });
                }}
                className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-destructive disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1 sm:w-48">
          <span className="text-[11px] font-semibold text-muted-foreground">Name</span>
          <input
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Claude"
            maxLength={80}
            required
          />
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-28">
          <span className="text-[11px] font-semibold text-muted-foreground">Cost</span>
          <input
            className={FIELD}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="30"
            inputMode="decimal"
            required
          />
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-24">
          <span className="text-[11px] font-semibold text-muted-foreground">Currency</span>
          <select className={FIELD} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="sgd">SGD</option>
            <option value="usd">USD</option>
          </select>
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-28">
          <span className="text-[11px] font-semibold text-muted-foreground">Charged</span>
          <select className={FIELD} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-9 w-full rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto"
        >
          Add
        </button>
      </form>
    </div>
  );
}
