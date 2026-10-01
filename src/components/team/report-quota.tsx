"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

/**
 * One person's weekly calls owed, edited by the person who manages them
 * (2026-10-01). Saves on blur or Enter; empty puts them back on the default.
 * Says out loud that it saved, since the page behind it takes a moment to
 * refresh and a save that worked looks like one that hung.
 */
export function ReportQuota({
  userId,
  name,
  quota,
  fallback,
}: {
  userId: number;
  name: string;
  /** Their own figure, or null when they are on the default. */
  quota: number | null;
  fallback: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(quota === null ? "" : String(quota));
  const [synced, setSynced] = React.useState(quota);
  const [busy, setBusy] = React.useState(false);
  if (quota !== synced) {
    setSynced(quota);
    setDraft(quota === null ? "" : String(quota));
  }

  const commit = async () => {
    const next = draft === "" ? null : Number(draft);
    if (next === quota) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/my-team/${userId}/quota`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyQuota: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that.");
        setDraft(quota === null ? "" : String(quota));
        return;
      }
      toast.success(
        next === null
          ? `${name} is back on the standard ${fallback} calls a week.`
          : `${name} now owes ${next} calls a week.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
      Calls owed each week
      <Input
        value={draft}
        disabled={busy}
        inputMode="numeric"
        placeholder={String(fallback)}
        className="h-8 w-28 text-[13px]"
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(quota === null ? "" : String(quota));
        }}
      />
      <span className="font-normal">
        Leave empty for the standard {fallback}. It decides who is flagged as
        behind and has no effect on pay.
      </span>
    </label>
  );
}
