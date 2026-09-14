"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { partName } from "@/lib/list-name";
import { evenShares } from "@/lib/split-deal";
import { cn } from "@/lib/utils";

/** The server's ceiling, restated for the picker. */
const MAX_PARTS = 10;

/** Half the slider handle's width in px (`size-5`). The slider keeps a handle's
 *  centre this far inside each end, so the coloured shares are laid out on the
 *  same inset scale or they would not line up with the handles. */
const HALF_THUMB = 10;

/** Running totals at the end of every part but the last — where the handles
 *  sit for those sizes. */
function cumulative(sizes: number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const s of sizes.slice(0, -1)) {
    run += s;
    out.push(run);
  }
  return out;
}

/** Alternating shades, so neighbouring shares read as separate lists. */
const shade = (i: number) => (i % 2 === 0 ? "bg-primary/75" : "bg-primary/35");

/**
 * Rename, split or delete a list.
 *
 * All three live behind a menu rather than on the card, because none is an
 * everyday action and the two chips beside this one are. Positioned over the
 * card like they are: the card is one big link, and a menu nested in an anchor
 * navigates as it opens.
 *
 * Delete says what it is about to destroy, in numbers, before it does it. The
 * usual reason to reach for it is a list imported from the wrong file, where
 * the honest count is "231 leads, no calls" and the decision is easy — but the
 * same button on a worked list would take real history with it, and that case
 * should read differently.
 */
export function ListActions({
  listId,
  name,
  leads,
  uncalled,
  calls,
  people = [],
}: {
  listId: number;
  name: string;
  /** Leads that can be rung, duplicates excluded — exactly what a split deals. */
  leads: number;
  /** Of those, how many nobody has rung yet. Lets each share say how much of it
   *  is fresh, which is usually the question behind an uneven split. */
  uncalled?: number;
  /** Calls logged against this list's leads. Deleting takes them too. */
  calls: number;
  /** Who a part can be handed to. Deactivated people stay in the list for the
   *  reason they stay assignable elsewhere: switching somebody off for a
   *  fortnight should not silently strip their niches. */
  people?: { id: number; name: string; active: boolean }[];
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [splitting, setSplitting] = React.useState(false);
  const [parts, setParts] = React.useState<{ name: string; owner: string }[]>([]);
  /**
   * Where the slider's handles sit, or null for an even split.
   *
   * Null is the default and the state the dialog returns to whenever the
   * handles are put back on the even positions, so "Even" on screen always
   * means the server will deal evenly — no sizes are sent at all.
   */
  const [bounds, setBounds] = React.useState<number[] | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const [busy, setBusy] = React.useState(false);

  /** Open the split dialog with N parts, named the way the importer names them
   *  (`partName`) so a split here and a split on the way in read the same. */
  function openSplit(count: number) {
    setParts(
      Array.from({ length: count }, (_, i) => ({
        name: partName(name, i),
        owner: "",
      })),
    );
    setBounds(null);
    setSplitting(true);
  }

  const evenSizes = evenShares(leads, parts.length);
  const evenBounds = cumulative(evenSizes);
  const handles = bounds ?? evenBounds;
  const sizes = bounds
    ? [...bounds, leads].map((end, i, ends) => end - (i === 0 ? 0 : ends[i - 1]))
    : evenSizes;

  function moveHandles(next: number[]) {
    // Every list keeps at least one lead, so no handle may reach an end or sit
    // on its neighbour. The slider already keeps handles a step apart; the
    // ends are held here.
    const held = next.map((b, i) =>
      Math.min(Math.max(b, i + 1), leads - (next.length - i)),
    );
    setBounds(held.every((b, i) => b === evenBounds[i]) ? null : held);
  }

  /** A position on the shares bar, on the same inset scale as the handles. */
  const at = (count: number) =>
    `calc(${HALF_THUMB}px + ${count / leads} * (100% - ${HALF_THUMB * 2}px))`;

  async function split() {
    setBusy(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parts: parts.map((p, i) => ({
            name: p.name,
            assignedUserId: p.owner === "" ? null : Number(p.owner),
            // Only when the slider moved. An even split sends no sizes, so the
            // server counts the list at that moment and deals it evenly.
            ...(bounds ? { leads: sizes[i] } : {}),
          })),
        }),
      });
      const data = (await res.json()) as { error?: string; parts?: { name: string }[] };
      if (!res.ok) {
        toast.error(data.error ?? "Could not split that list.");
        return;
      }
      setSplitting(false);
      toast.success(`Split into ${data.parts?.length ?? parts.length} lists.`);
      router.refresh();
    } catch {
      toast.error("Could not split that list.");
    } finally {
      setBusy(false);
    }
  }

  // Only the trigger needs this: it sits on top of the card, which is one big
  // link. The menu and both dialogs render through a portal, so their clicks
  // never reach that anchor — and calling preventDefault on them would cancel
  // the submit button's own default action, which is how the rename form
  // silently did nothing.
  const stopTrigger = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (busy || next === "" || next === name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not rename it.");
        return;
      }
      toast.success(`Renamed to “${next}”.`);
      setRenaming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/call-lists/${listId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not delete it.");
        return;
      }
      toast.success(`Deleted “${data.name}” and ${data.leads} leads.`);
      setDeleting(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${name}`}
            onClick={stopTrigger}
            className="flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-3.5" strokeWidth={2.2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(name);
              setRenaming(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={leads < 2}
            onSelect={() => openSplit(2)}
          >
            Split between callers
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleting(true)}
          >
            Delete list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rename}>
            <DialogHeader>
              <DialogTitle>Rename list</DialogTitle>
              <DialogDescription>
                Only the name changes. The leads, folder and owner stay as they
                are.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor={`rename-${listId}`}>Name</Label>
              <Input
                id={`rename-${listId}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || draft.trim() === ""}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={splitting} onOpenChange={setSplitting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Split “{name}”</DialogTitle>
            <DialogDescription>
              Leads are dealt out one at a time, not cut into blocks — a scrape
              arrives sorted by city or rating, so slicing it would hand one
              caller every Alaska lead. Every list gets the same mix, whatever
              its size. Calls already logged stay with their lead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="split-count" className="text-[13px]">
                Into
              </Label>
              <select
                id="split-count"
                value={parts.length}
                onChange={(e) => openSplit(Number(e.target.value))}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {Array.from(
                  { length: Math.max(0, Math.min(MAX_PARTS, leads) - 1) },
                  (_, i) => i + 2,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n} lists
                  </option>
                ))}
              </select>
            </div>

            {parts.length > 1 && leads >= parts.length && (
              <div className="space-y-2">
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold">
                    {bounds ? "Custom split" : "Even split"}
                  </p>
                  {bounds && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setBounds(null)}
                    >
                      Make it even
                    </Button>
                  )}
                </div>

                <SliderPrimitive.Root
                  value={handles}
                  onValueChange={moveHandles}
                  min={0}
                  max={leads}
                  step={1}
                  minStepsBetweenThumbs={1}
                  className="relative flex h-8 w-full touch-none select-none items-center"
                >
                  <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden rounded-full bg-muted">
                    {/* Each list's share, laid under the handles. */}
                    {sizes.map((_, i) => {
                      const start = i === 0 ? 0 : handles[i - 1];
                      const end = i === sizes.length - 1 ? leads : handles[i];
                      return (
                        <div
                          key={i}
                          className={cn("absolute inset-y-0", shade(i))}
                          style={{
                            left: i === 0 ? "0px" : at(start),
                            right:
                              i === sizes.length - 1
                                ? "0px"
                                : `calc(100% - ${at(end)})`,
                          }}
                        />
                      );
                    })}
                  </SliderPrimitive.Track>
                  {handles.map((_, i) => (
                    <SliderPrimitive.Thumb
                      key={i}
                      aria-label={`Between ${parts[i]?.name || `list ${i + 1}`} and ${parts[i + 1]?.name || `list ${i + 2}`}`}
                      className="block size-5 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
                    />
                  ))}
                </SliderPrimitive.Root>

                <p className="text-[12px] text-muted-foreground">
                  Drag a handle to give the list on one side more leads and the
                  one on the other side fewer. Click a handle and use the arrow
                  keys to move it one lead at a time.
                </p>
              </div>
            )}

            {parts.map((part, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full", shade(i))}
                />
                <Input
                  value={part.name}
                  onChange={(e) =>
                    setParts((p) =>
                      p.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  className="h-9 min-w-0 flex-1"
                  aria-label={`Name for list ${i + 1}`}
                />
                <select
                  value={part.owner}
                  onChange={(e) =>
                    setParts((p) =>
                      p.map((x, n) => (n === i ? { ...x, owner: e.target.value } : x)),
                    )
                  }
                  aria-label={`Owner for list ${i + 1}`}
                  className="h-9 w-28 shrink-0 rounded-md border bg-background px-2 text-sm sm:w-36"
                >
                  <option value="">Nobody</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.active ? "" : " (off)"}
                    </option>
                  ))}
                </select>
                <span className="w-20 shrink-0 text-right text-[12px] leading-tight tabular-nums text-muted-foreground">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {sizes[i]} {sizes[i] === 1 ? "lead" : "leads"}
                  </span>
                  {uncalled !== undefined && leads > 0 && (
                    // An estimate, and labelled as one: the deal mixes fresh
                    // and already-rung leads in proportion, not exactly.
                    <span className="block">
                      ~{Math.round((sizes[i] * uncalled) / leads)} not rung
                    </span>
                  )}
                </span>
              </div>
            ))}

            <p className="text-[12px] text-muted-foreground">
              “{name}” keeps its calls and becomes the first list, so nothing
              logged against it is lost.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitting(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={split} disabled={busy || parts.some((p) => !p.name.trim())}>
              {busy ? "Splitting…" : `Split into ${parts.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>
              {leads} {leads === 1 ? "lead" : "leads"}
              {calls > 0
                ? ` and ${calls} logged ${calls === 1 ? "call" : "calls"} will be deleted permanently.`
                : " will be deleted permanently. No calls have been logged against this list."}
            </DialogDescription>
          </DialogHeader>
          {calls > 0 && (
            // Worth a second look: leads are re-importable from the CSV, a
            // record of who was rung and what they said is not.
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-semibold text-destructive">
              This list has been worked. The call history goes with it and
              cannot be recovered.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleting(false)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : calls > 0 ? "Delete anyway" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
