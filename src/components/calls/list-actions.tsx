"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
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

/**
 * Rename or delete a list.
 *
 * Both live behind a menu rather than on the card, because neither is an
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
  calls,
}: {
  listId: number;
  name: string;
  leads: number;
  /** Calls logged against this list's leads. Deleting takes them too. */
  calls: number;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const [busy, setBusy] = React.useState(false);

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
