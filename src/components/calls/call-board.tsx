"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import type { BoardCard, CallOutcome, CallStage } from "@/lib/calls";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The five columns, and the outcome a card dropped on one records.
 *
 * Every move on this board is a call that happened — there is no stored status
 * to set, so the only honest way to move a card is to log the call that moved
 * it. "To call" therefore takes no drops: nothing you can do on the phone puts
 * a lead back to never having been rung. (The spreadsheet can, by deleting the
 * call, which is an undo rather than an outcome.)
 */
const COLUMNS: {
  key: CallStage;
  label: string;
  logs: CallOutcome | null;
  hint: string;
}[] = [
  { key: "to_call", label: "To call", logs: null, hint: "Never rung" },
  { key: "tried", label: "Tried", logs: "no_answer", hint: "No answer, voicemail, gatekeeper" },
  { key: "callback", label: "Call back", logs: "callback", hint: "Asked to be rung later" },
  { key: "interested", label: "Interested", logs: "interested", hint: "Wants to hear more" },
  { key: "demo_booked", label: "Demo booked", logs: "demo_booked", hint: "In the diary" },
];

/** Outcomes offered on a card's menu — the touch and keyboard route, and the
 *  only way to reach the ones no column stands for. */
const LOGGABLE = Object.keys(OUTCOME_LABELS) as CallOutcome[];

function when(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function due(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function CopyNumber({ phone }: { phone: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${phone}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(phone.trim());
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Could not copy — select the number and copy it.");
        }
      }}
      className={cn(
        "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-bold tabular-nums transition-colors",
        copied
          ? "bg-success text-primary-foreground"
          : "bg-primary/10 text-primary hover:bg-primary/15",
      )}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.6} />
      ) : (
        <Copy className="size-3.5" strokeWidth={2.2} />
      )}
      {copied ? "Copied" : phone}
    </button>
  );
}

export function CallBoard({
  cards,
  closed,
  columnLimit,
  demo = false,
}: {
  cards: BoardCard[];
  /** Leads finished with, counted rather than carried. */
  closed: number;
  columnLimit: number;
  demo?: boolean;
}) {
  const router = useRouter();
  const [dragId, setDragId] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<CallStage | null>(null);
  // A logged call moves the card at once; the server list catches up behind.
  const [logged, setLogged] = React.useState<
    Record<number, { outcome: CallOutcome; attempts: number }>
  >({});

  const rows = React.useMemo(
    () =>
      cards.map((c) => {
        const l = logged[c.id];
        if (!l) return c;
        return {
          ...c,
          lastOutcome: l.outcome,
          attempts: l.attempts,
          lastCalledAt: new Date().toISOString(),
          stage: stageFor(l.outcome),
        };
      }),
    [cards, logged],
  );

  async function logCall(card: BoardCard, outcome: CallOutcome) {
    const attempts = (logged[card.id]?.attempts ?? card.attempts) + 1;
    const who = card.company ?? card.name ?? card.phone;
    if (demo) {
      setLogged((p) => ({ ...p, [card.id]: { outcome, attempts } }));
      toast.success(`${OUTCOME_LABELS[outcome]} — demo, not saved`);
      return;
    }
    setLogged((p) => ({ ...p, [card.id]: { outcome, attempts } }));
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLeadId: card.id, outcome }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not log the call.");
        setLogged((p) => {
          const next = { ...p };
          delete next[card.id];
          return next;
        });
        return;
      }
      toast.success(`${OUTCOME_LABELS[outcome]} — ${who}, attempt ${attempts}`);
      router.refresh();
    } catch {
      toast.error("Could not log the call — network error.");
      setLogged((p) => {
        const next = { ...p };
        delete next[card.id];
        return next;
      });
    }
  }

  return (
    // Five columns only fit a wide screen; narrower than `lg` this is a
    // snapping horizontal scroller, one column at a time — the same shape the
    // email board takes.
    <div className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-x-visible lg:px-0">
      {COLUMNS.map((col) => {
        const all = rows.filter((c) => c.stage === col.key);
        const shown = all.slice(0, columnLimit);
        return (
          <div
            key={col.key}
            data-column={col.key}
            className={cn(
              "flex min-h-0 w-[78vw] max-w-[320px] shrink-0 snap-start flex-col rounded-lg border bg-muted/30 lg:w-auto lg:max-w-none lg:shrink",
              dragOver === col.key && "border-primary/50 bg-primary/5",
            )}
            onDragOver={(e) => {
              if (!col.logs) return;
              e.preventDefault();
              setDragOver(col.key);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const card = rows.find((c) => c.id === dragId);
              setDragId(null);
              if (card && col.logs && card.stage !== col.key) {
                logCall(card, col.logs);
              }
            }}
          >
            <div className="flex shrink-0 items-baseline gap-2 px-3 pb-1 pt-2.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {col.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground/70">
                {all.length}
              </span>
              {all.length > shown.length && (
                <span className="ml-auto text-[11px] text-muted-foreground/70">
                  showing {shown.length}
                </span>
              )}
            </div>
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {shown.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(c.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  className="group cursor-grab rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-ring/60 active:cursor-grabbing"
                  data-lead-id={c.id}
                >
                  <p className="text-[13px] font-bold leading-tight">
                    {c.company ?? c.name ?? c.phone}
                  </p>
                  {c.name && c.company && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.name}
                    </p>
                  )}

                  <CopyNumber phone={c.phone} />

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className="max-w-32 justify-start text-[11px]"
                    >
                      <span className="min-w-0 truncate">{c.listName}</span>
                    </Badge>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {c.stage === "callback" && c.callbackAt
                        ? due(c.callbackAt)
                        : c.attempts > 0
                          ? `${c.attempts} ${c.attempts === 1 ? "try" : "tries"} · ${when(c.lastCalledAt)}`
                          : "not tried"}
                    </span>
                  </div>

                  {/* Dragging is a mouse gesture — HTML5 drag events never
                      fire on touch — so every outcome is also reachable from
                      a menu, which is the only route on a phone. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1 text-[11px] text-muted-foreground transition-[color,opacity] hover:border-solid hover:text-foreground lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 lg:data-[state=open]:opacity-100">
                      <PhoneOutgoing className="size-3" />
                      Log a call
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>
                        Attempt {c.attempts + 1}
                      </DropdownMenuLabel>
                      {LOGGABLE.map((o) => (
                        <DropdownMenuItem
                          key={o}
                          onSelect={() => logCall(c, o)}
                        >
                          {OUTCOME_LABELS[o]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}

              {shown.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground/70">
                  {col.hint}
                </p>
              )}
              {all.length > shown.length && (
                <p className="rounded-md border border-dashed px-2 py-2 text-center text-[11px] text-muted-foreground">
                  {(all.length - shown.length).toLocaleString()} more — work
                  them from the dialler or the spreadsheet.
                </p>
              )}
            </div>
          </div>
        );
      })}

      {closed > 0 && (
        <p className="sr-only">
          {closed} leads are finished with and not shown on the board.
        </p>
      )}
    </div>
  );
}

/** Mirror of `stageOf` in lib/calls for the optimistic move; the server is
 *  still the one that decides, on the next refresh. */
function stageFor(outcome: CallOutcome): CallStage {
  if (outcome === "callback") return "callback";
  if (outcome === "interested") return "interested";
  if (outcome === "demo_booked") return "demo_booked";
  if (outcome === "not_interested" || outcome === "bad_number") return "closed";
  return "tried";
}
