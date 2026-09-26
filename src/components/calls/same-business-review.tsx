"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import {
  SameBusinessList,
  TickAll,
} from "@/components/calls/same-business-rows";
import type { SameBusinessGroup } from "@/lib/same-business";
import { websiteLabel } from "@/lib/website";

/**
 * The same business on several leads already in the CRM, to tick and hold out.
 *
 * The importer asks this question of a new file; this asks it of what was
 * imported before the importer could. Loaded when opened, not with the page:
 * it compares every lead in the CRM, which the Call lists screen has no reason
 * to pay for on every visit.
 *
 * Only leads nobody has rung are offered, because flagging one takes it off
 * the board and out of its list's counts. The dialog says so, since a caller
 * rung twice already would otherwise expect to find that pair here.
 */
export function SameBusinessReview() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [groups, setGroups] = React.useState<SameBusinessGroup[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ticked, setTicked] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [held, setHeld] = React.useState<number | null>(null);
  // Groups folded shut, by the kept lead's id. Ticking a whole group or
  // keeping all of it folds it, so the next one comes up without scrolling
  // past rows already decided (2026-09-26: 46 groups, one tick at a time).
  const [folded, setFolded] = React.useState<Set<number>>(new Set());
  const fold = (id: number, shut: boolean) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (shut) next.add(id);
      else next.delete(id);
      return next;
    });

  const load = React.useCallback(async () => {
    setGroups(null);
    setError(null);
    setTicked([]);
    setFolded(new Set());
    try {
      const res = await fetch("/api/call-leads/same-business");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not check the leads.");
      setGroups(data.groups as SameBusinessGroup[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the leads.");
    }
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setHeld(null);
      void load();
    }
  }

  async function holdOut() {
    if (ticked.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/call-leads/same-business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: ticked.map(Number) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setHeld(data.held as number);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const total = groups?.reduce((a, g) => a + g.candidates.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Copy data-icon="inline-start" />
          Repeated businesses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>The same business on more than one lead</DialogTitle>
          <DialogDescription>
            A scrape lists a business once for every location and phone number,
            so a caller can ring the same office twice in a few minutes. These
            leads match another by name or website. Tick the ones that really
            are the same business and they leave everybody&rsquo;s queue.
            Nothing changes for the ones you leave unticked.
          </DialogDescription>
        </DialogHeader>

        {held !== null && (
          <p className="rounded-md bg-success/10 px-3 py-2 text-[13px] text-foreground">
            {held === 0
              ? "Nothing was held out. Those leads had been rung or merged in the meantime."
              : `${held} ${held === 1 ? "lead" : "leads"} held out of the queue.`}
          </p>
        )}

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        {groups === null && !error ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Comparing every lead…
          </p>
        ) : groups && groups.length === 0 ? (
          <p className="py-6 text-[13px] text-muted-foreground">
            No repeats left to check. Every business that matched another has
            been rung already or dealt with.
          </p>
        ) : groups ? (
          <>
            <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
              <span>
                {total} {total === 1 ? "lead" : "leads"} in {groups.length}{" "}
                {groups.length === 1 ? "business" : "businesses"}. Only leads
                nobody has rung are listed, so no call history is touched.
              </span>
              <TickAll
                keys={groups.flatMap((g) => g.candidates.map((c) => String(c.id)))}
                ticked={ticked}
                onChange={setTicked}
              />
            </div>
            <ul className="space-y-3">
              {groups.map((g) => {
                const keys = g.candidates.map((c) => String(c.id));
                const nTicked = keys.filter((k) => ticked.includes(k)).length;
                const shut = folded.has(g.keep.id!);
                return (
                <li key={g.keep.id} className="rounded-lg border p-3">
                  {/* The group's own controls, so a whole business is one
                      decision rather than a tick per row. */}
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fold(g.keep.id!, !shut)}
                      aria-expanded={!shut}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-semibold"
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 transition-transform ${shut ? "-rotate-90" : ""}`}
                      />
                      <span className="truncate">
                        {g.keep.company || "a lead with no name"}
                      </span>
                      <span className="shrink-0 font-normal text-muted-foreground">
                        {nTicked === keys.length
                          ? `all ${keys.length} ticked`
                          : nTicked > 0
                            ? `${nTicked} of ${keys.length} ticked`
                            : shut
                              ? `keeping all ${keys.length}`
                              : `${keys.length} to check`}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant={nTicked === keys.length ? "secondary" : "outline"}
                      onClick={() => {
                        if (nTicked === keys.length) {
                          setTicked(ticked.filter((k) => !keys.includes(k)));
                          fold(g.keep.id!, false);
                        } else {
                          setTicked([...new Set([...ticked, ...keys])]);
                          fold(g.keep.id!, true);
                        }
                      }}
                    >
                      {nTicked === keys.length ? "Untick all" : `Tick all ${keys.length}`}
                    </Button>
                    {nTicked === 0 && !shut && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fold(g.keep.id!, true)}
                      >
                        Keep all
                      </Button>
                    )}
                  </div>
                  {!shut && (
                  <>
                  <p className="text-[12px] text-muted-foreground">
                    Keeping{" "}
                    <span className="font-semibold text-foreground">
                      {g.keep.company || "a lead with no name"}
                    </span>{" "}
                    · {g.keep.phone}
                    {g.keep.where && ` · ${g.keep.where}`}
                    {g.keep.website && ` · ${websiteLabel(g.keep.website)}`}
                    {g.keep.list && ` · on ${g.keep.list}`}
                    {g.keep.owner && ` (${g.keep.owner})`} ·{" "}
                    {g.keep.lastOutcome
                      ? `last call: ${OUTCOME_LABELS[g.keep.lastOutcome]}`
                      : "not rung yet"}
                  </p>
                  <SameBusinessList
                    offLabel="Keep"
                    items={g.candidates.map((c) => ({
                      key: String(c.id),
                      lead: c,
                      reason: c.reason,
                      reasonAgainst: g.keep,
                      looksLike: [],
                    }))}
                    ticked={ticked}
                    onChange={setTicked}
                    className="mt-1"
                  />
                  </>
                  )}
                </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {/* Pinned, so saving does not mean scrolling past 46 groups. */}
        <DialogFooter className="sticky -bottom-4 z-10 items-center gap-2 bg-popover sm:justify-between">
          <p className="text-[13px] text-muted-foreground">
            {ticked.length > 0 &&
              `${ticked.length} ticked, to be held out as copies of the lead kept above them.`}
          </p>
          <Button
            onClick={holdOut}
            disabled={ticked.length === 0 || saving}
          >
            {saving
              ? "Saving…"
              : ticked.length > 0
                ? `Hold ${ticked.length} out of the queue`
                : "Tick a lead to hold it out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
