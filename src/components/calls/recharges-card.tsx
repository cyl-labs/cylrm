"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type RechargeRow = { id: number; paidOn: string; amount: string };

const FIELD =
  "h-9 rounded-md border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * ElevenLabs top-ups, typed in when paid. Its API reports the plan and the
 * credits used but not what was bought on top, so this is the only record.
 */
export function RechargesCard({
  rows,
  today,
}: {
  rows: RechargeRow[];
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("usd");
  const [paidOn, setPaidOn] = React.useState(today);

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

  return (
    <div>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          No recharges logged. Each time you top up ElevenLabs, add the amount
          below so it counts in the total above.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 text-[13px]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline gap-3 py-2">
              <span className="text-muted-foreground">{r.paidOn}</span>
              <span className="ml-auto tabular-nums">{r.amount}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm("Remove this recharge?")) return;
                  void call(`/api/recharges/${r.id}`, { method: "DELETE" });
                }}
                className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-destructive disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void call(
            "/api/recharges",
            { method: "POST", body: JSON.stringify({ amount, currency, paidOn }) },
            () => setAmount(""),
          );
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <label className="flex w-full flex-col gap-1 sm:w-28">
          <span className="text-[11px] font-semibold text-muted-foreground">Paid</span>
          <input
            className={FIELD}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="20"
            inputMode="decimal"
            required
          />
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-24">
          <span className="text-[11px] font-semibold text-muted-foreground">Currency</span>
          <select className={FIELD} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="usd">USD</option>
            <option value="sgd">SGD</option>
          </select>
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-40">
          <span className="text-[11px] font-semibold text-muted-foreground">On</span>
          <input
            type="date"
            className={FIELD}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-9 w-full rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto"
        >
          Add recharge
        </button>
      </form>
    </div>
  );
}
