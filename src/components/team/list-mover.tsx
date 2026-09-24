"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, EllipsisVertical, GripVertical, ListX } from "lucide-react";
import { toast } from "sonner";
import type { TeamList } from "@/lib/lead-stock";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MARKET: Record<string, string> = { sg: "Singapore", us: "US", gb: "UK" };

export type MoverPerson = { id: number; name: string; market: string | null };

type Pending =
  | { kind: "move"; list: TeamList; from: MoverPerson; to: MoverPerson }
  | { kind: "remove"; list: TeamList; from: MoverPerson };

type Ctx = {
  people: MoverPerson[];
  dragging: { list: TeamList; from: MoverPerson } | null;
  setDragging: (d: { list: TeamList; from: MoverPerson } | null) => void;
  ask: (p: Pending) => void;
};

const MoverContext = React.createContext<Ctx | null>(null);

/**
 * Moving lists between people on Team (2026-09-25): drag a list card onto
 * somebody else's row, or use the card's menu, and confirm. Taking a list off
 * somebody is the same menu. It unassigns, never deletes: the leads, their
 * calls and callbacks stay on the list, and whoever gets it next picks them up.
 *
 * Everything goes through `PATCH /api/call-lists/[id]`, the route Call lists
 * and "Give them another" already use, so there is still one place deciding
 * whether a change is allowed. Always confirmed, because a list moved by a
 * slipped drag is a caller signing in to somebody else's work, with an Undo on
 * the toast for the mistake noticed a second later.
 *
 * Drag is desktop only: HTML5 drag events never fire on touch. The menu on each
 * card is the phone's route, and the keyboard's.
 */
export function ListMoverProvider({
  people,
  children,
}: {
  /** Everyone a list can be given to: active people on the team. */
  people: MoverPerson[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [dragging, setDragging] = React.useState<Ctx["dragging"]>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function assign(listId: number, to: number | null): Promise<boolean> {
    const res = await fetch(`/api/call-lists/${listId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedUserId: to }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not change that list.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function confirm() {
    if (!pending) return;
    const p = pending;
    setSaving(true);
    try {
      const ok = await assign(p.list.id, p.kind === "move" ? p.to.id : null);
      if (!ok) return;
      setPending(null);
      toast.success(
        p.kind === "move"
          ? `${p.list.name} is ${p.to.name}'s now`
          : `${p.list.name} is off ${p.from.name}'s list`,
        {
          description:
            p.kind === "move"
              ? `Taken off ${p.from.name}.`
              : "Nobody is calling it until you give it to someone.",
          duration: 12_000,
          action: {
            label: "Undo",
            onClick: () => {
              void assign(p.list.id, p.from.id).then(
                (back) => back && toast.success(`${p.list.name} is ${p.from.name}'s again.`),
              );
            },
          },
        },
      );
    } finally {
      setSaving(false);
    }
  }

  const wrongMarket =
    pending?.kind === "move" &&
    pending.list.region !== null &&
    pending.to.market !== null &&
    pending.list.region !== pending.to.market;

  return (
    <MoverContext.Provider value={{ people, dragging, setDragging, ask: setPending }}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && !saving && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending.kind === "move"
                    ? `Give ${pending.list.name} to ${pending.to.name}?`
                    : `Take ${pending.list.name} off ${pending.from.name}?`}
                </DialogTitle>
                <DialogDescription>
                  {pending.kind === "move" ? (
                    <>
                      It comes off {pending.from.name}&apos;s list and onto{" "}
                      {pending.to.name}&apos;s, callbacks and all.{" "}
                      {pending.from.name} stops seeing it straight away.
                    </>
                  ) : (
                    <>
                      Nobody will be calling it until you give it to someone.
                      The leads, their calls and their callbacks stay on the
                      list. Nothing is deleted.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
                <span className="font-semibold">{pending.list.name}</span>:{" "}
                {pending.list.total.toLocaleString("en-US")} leads,{" "}
                {pending.list.uncalled.toLocaleString("en-US")} never rung,{" "}
                {pending.list.leftToCall.toLocaleString("en-US")} left to call.
              </p>
              {wrongMarket && pending.kind === "move" && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                  This is a {MARKET[pending.list.region!] ?? pending.list.region}{" "}
                  list and {pending.to.name} calls{" "}
                  {MARKET[pending.to.market!] ?? pending.to.market}. They will
                  not be able to ring any of it.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={saving} onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant={pending.kind === "remove" ? "destructive" : "default"}
                  disabled={saving}
                  onClick={() => void confirm()}
                >
                  {saving
                    ? "Saving…"
                    : pending.kind === "move"
                      ? `Give it to ${pending.to.name}`
                      : "Take it off"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MoverContext.Provider>
  );
}

/** A list card that can be dragged to another row, with a menu for the rest.
 *  Renders `children` (the card itself) untouched when there is no provider,
 *  which is a reader who cannot manage the team. */
export function MovableList({
  list,
  owner,
  children,
}: {
  list: TeamList;
  owner: MoverPerson;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(MoverContext);
  if (!ctx) return <>{children}</>;
  const others = ctx.people.filter((p) => p.id !== owner.id);
  const isDragged = ctx.dragging?.list.id === list.id;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(list.id));
        ctx.setDragging({ list, from: owner });
      }}
      onDragEnd={() => ctx.setDragging(null)}
      className={cn("group/list relative", isDragged && "opacity-40")}
      title="Drag onto someone else's row to give it to them"
    >
      <GripVertical
        aria-hidden
        className="pointer-events-none absolute -left-3.5 top-2 hidden size-3.5 text-muted-foreground/50 group-hover/list:block"
      />
      {children}
      {/* Beside the link rather than inside it: a menu nested in an anchor
          navigates as it opens, the trap Call lists already works around. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Move or remove ${list.name}`}
            className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
          >
            <EllipsisVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="truncate">{list.name}</DropdownMenuLabel>
          {others.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <ArrowRightLeft className="size-3.5" />
                Give to someone else
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {others.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => ctx.ask({ kind: "move", list, from: owner, to: p })}
                  >
                    {p.name}
                    {p.market && (
                      <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
                        {MARKET[p.market] ?? p.market}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onSelect={() => ctx.ask({ kind: "remove", list, from: owner })}
          >
            <ListX className="size-3.5" />
            Take it off {owner.name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A person's list cell as a place to drop a list dragged from another row. */
export function ListDropZone({
  person,
  children,
}: {
  person: MoverPerson;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(MoverContext);
  const [over, setOver] = React.useState(false);
  if (!ctx) return <>{children}</>;
  const d = ctx.dragging;
  const accepts =
    d !== null && d.from.id !== person.id && ctx.people.some((p) => p.id === person.id);

  return (
    <div
      onDragOver={(e) => {
        if (!accepts) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!accepts || !d) return;
        ctx.setDragging(null);
        ctx.ask({ kind: "move", list: d.list, from: d.from, to: person });
      }}
      className={cn(
        "-m-1.5 rounded-lg p-1.5 transition-colors",
        accepts && "outline outline-1 outline-dashed outline-primary/40",
        over && "bg-primary/10 outline-2 outline-primary",
      )}
    >
      {children}
      {over && (
        <p className="mt-1 text-[11px] font-semibold text-primary">
          Drop to give it to {person.name}
        </p>
      )}
    </div>
  );
}
