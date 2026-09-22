"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Write the briefing for every upcoming demo.
 *
 * Says what it is going to do before it does it, because this one costs money
 * and takes a few seconds — unlike every other button on these screens, which
 * are instant and free. The count comes from the server rather than being
 * guessed here.
 *
 * Nothing is regenerated that has not changed: the route hashes the material
 * each brief was written from, so the common press — reopening the document
 * before a demo — writes nothing and spends nothing. `force` is the second
 * button, for when the reading itself looks wrong rather than the material
 * having moved.
 */
export function GenerateBriefing({
  stale,
  missing,
}: {
  /** Briefs whose call has had something logged since they were written. */
  stale: number;
  /** Upcoming demos with no brief at all. */
  missing: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "new" | "all">(null);

  async function run(force: boolean) {
    setBusy(force ? "all" : "new");
    try {
      const res = await fetch("/api/meetings/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        written?: number;
        reused?: number;
        failed?: { company: string }[];
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Could not write the briefing.");
        return;
      }
      const written = data?.written ?? 0;
      const failed = data?.failed ?? [];
      if (written === 0 && failed.length === 0) {
        toast.success("Already up to date — nothing has changed.");
      } else {
        toast.success(
          `Wrote ${written} ${written === 1 ? "brief" : "briefs"}.` +
            (data?.reused ? ` ${data.reused} already up to date.` : ""),
        );
      }
      // Named, not counted: "1 failed" tells nobody which demo they are about
      // to walk into without a briefing.
      if (failed.length > 0) {
        toast.error(
          `No brief for ${failed.map((f) => f.company).join(", ")}.`,
        );
      }
      router.refresh();
    } catch {
      toast.error("Could not write the briefing.");
    } finally {
      setBusy(null);
    }
  }

  const todo = stale + missing;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy !== null} onClick={() => run(false)}>
        <RefreshCw
          className={busy === "new" ? "size-3.5 animate-spin" : "size-3.5"}
        />
        {busy === "new"
          ? "Reading the calls…"
          : todo > 0
            ? `Write ${todo} ${todo === 1 ? "brief" : "briefs"}`
            : "Check for new calls"}
      </Button>
      {/* Only offered once there is something to redo. On a fresh document it
          would be a second button that does the same as the first. */}
      {todo === 0 && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => run(true)}
        >
          {busy === "all" ? "Rewriting…" : "Rewrite all"}
        </Button>
      )}
    </div>
  );
}
