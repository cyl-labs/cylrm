"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Check, Copy, PhoneOutgoing, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { BoardCard, CallOutcome, CallStage } from "@/lib/calls";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import { RecordingSheet } from "@/components/calls/recording-sheet";
import { useTouchDrag } from "@/components/kanban/use-touch-drag";
import { dialableNumber } from "@/lib/phone";
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
 * The seven columns, and the outcome a card dropped on one records.
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
  {
    key: "tried",
    label: "Tried",
    logs: "no_answer",
    hint: "No answer, voicemail, gatekeeper",
  },
  {
    key: "callback",
    label: "Call back",
    logs: "callback",
    hint: "Asked to be rung later",
  },
  {
    key: "demo_booked",
    label: "Demo booked",
    logs: "demo_booked",
    hint: "In the diary",
  },
  { key: "trial", label: "Trial", logs: "trial", hint: "Trying the product" },
  { key: "won", label: "Won", logs: "won", hint: "Contract signed" },
  {
    key: "lost",
    label: "Lost",
    logs: "lost",
    hint: "No sale: refused, wrong number, or a trial that did not convert",
  },
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

function CopyNumber({
  phone,
  blocked,
}: {
  phone: string;
  blocked?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  // Screening blocks the clipboard, not only a dial button — see dialler.tsx.
  if (blocked) {
    return (
      <span
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-dashed py-2 text-[13px] font-bold text-muted-foreground"
        title={blocked}
      >
        <ShieldAlert className="size-3.5 shrink-0" strokeWidth={2.2} />
        Do not call
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Copy ${phone}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(dialableNumber(phone));
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Could not copy: select the number and copy it.");
        }
      }}
      className={cn(
        "mt-2.5 flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md py-2 text-[13px] font-bold tabular-nums transition-colors",
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
  columnLimit,
  showList = true,
  showClosed = true,
}: {
  cards: BoardCard[];
  columnLimit: number;
  /** Won and Lost are the founders' view of a deal, not a caller's. A caller
   *  works the phone up to Demo booked; what happens weeks later is somebody
   *  else's column. False hides both, and drops them from the log menu too so
   *  no card can be moved somewhere it would then be invisible. */
  showClosed?: boolean;
  /** False when the board is already filtered to one niche, where the badge
   *  would repeat the same name on every card. */
  showList?: boolean;
}) {
  const router = useRouter();

  const columns = showClosed
    ? COLUMNS
    : COLUMNS.filter((c) => c.key !== "won" && c.key !== "lost");
  const loggable = showClosed
    ? LOGGABLE
    : LOGGABLE.filter((o) => o !== "won" && o !== "lost");
  const [dragId, setDragId] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<CallStage | null>(null);
  // A logged call moves the card at once; the server list catches up behind.
  const [logged, setLogged] = React.useState<
    Record<number, { outcome: CallOutcome; attempts: number }>
  >({});

  const scrollerRef = React.useRef<HTMLDivElement>(null);

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

  // Which card's recording is open. The sheet is mounted once, below the
  // board, rather than one per card: a Radix portal per card is a hundred
  // hidden dialogs on a full board.
  const [playing, setPlaying] = React.useState<BoardCard | null>(null);

  async function logCall(card: BoardCard, outcome: CallOutcome) {
    const attempts = (logged[card.id]?.attempts ?? card.attempts) + 1;
    const who = card.company ?? card.name ?? card.phone;
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
      toast.success(`${OUTCOME_LABELS[outcome]}: ${who}, attempt ${attempts}`);
      router.refresh();
    } catch {
      toast.error("Could not log the call: network error.");
      setLogged((p) => {
        const next = { ...p };
        delete next[card.id];
        return next;
      });
    }
  }

  // Touch has no HTML5 drag events, so the same gesture is rebuilt on pointer
  // events: hold a card, drag it, drop it on a column.
  const touch = useTouchDrag({
    scrollerRef,
    canDrop: (column) =>
      COLUMNS.some((c) => c.key === column && c.logs !== null),
    onDrop: (id, column) => {
      const card = rows.find((c) => c.id === id);
      const col = columns.find((c) => c.key === column);
      if (card && col?.logs && card.stage !== col.key) logCall(card, col.logs);
    },
  });
  const draggingCard = rows.find((c) => c.id === touch.dragId) ?? null;

  return (
    // Seven columns need a wide screen; below `xl` this is a snapping
    // horizontal scroller, one column at a time — the same shape the email
    // board takes, just with more to scroll through.
    <div
      ref={scrollerRef}
      className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 2xl:mx-0 2xl:grid 2xl:grid-cols-7 2xl:overflow-x-visible 2xl:px-0"
    >
      {columns.map((col) => {
        const all = rows.filter((c) => c.stage === col.key);
        const shown = all.slice(0, columnLimit);
        return (
          <div
            key={col.key}
            data-column={col.key}
            className={cn(
              "flex min-h-0 w-[78vw] max-w-[340px] shrink-0 snap-start flex-col rounded-lg border bg-muted/30 2xl:w-auto 2xl:max-w-none 2xl:shrink",
              (dragOver === col.key || touch.over === col.key) &&
                col.logs !== null &&
                "border-primary/50 bg-primary/5",
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
            <div className="flex shrink-0 items-baseline gap-2 px-3.5 pb-2 pt-3">
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
            <div
              data-column-scroll
              className="flex min-h-16 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5"
            >
              {shown.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(c.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  {...touch.cardProps(c.id)}
                  className={cn(
                    "group cursor-grab rounded-lg border bg-card p-3.5 shadow-xs transition-colors hover:border-ring/60 active:cursor-grabbing",
                    // The held card stays in place, faded, so the column does
                    // not reflow under the finger mid-drag.
                    touch.dragId === c.id && "opacity-40",
                  )}
                  data-lead-id={c.id}
                >
                  {/* `break-words` because a scrape sometimes lands a URL in
                      the company field — "https://www.zealous.com.sg/" is one
                      unbreakable word wanting 167px in a 111px card, so
                      without it the name simply runs off the edge and is cut
                      mid-character. Wrapping, rather than truncating: on a
                      board the company name is how you recognise the card. */}
                  <p className="text-[13px] font-bold leading-tight break-words">
                    {c.company ?? c.name ?? c.phone}
                  </p>
                  {c.name && c.company && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.name}
                    </p>
                  )}

                  <CopyNumber phone={c.phone} blocked={c.dncBlock} />

                  {/* Only on cards that actually have audio: a handset call,
                      a no-answer and any call made before browser dialling
                      have no recording, and an always-present button that
                      usually does nothing is worse than no button. */}
                  {c.recordingId && (
                    <button
                      type="button"
                      onClick={() => setPlaying(c)}
                      className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      <AudioLines className="size-3" />
                      Listen back
                    </button>
                  )}

                  {/* Wraps rather than truncates: with seven columns sharing
                      the width there is not always room for the list badge
                      and "2 tries · 4h ago" on one line. */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    {showList && (
                      <Badge
                        variant="outline"
                        className="max-w-32 justify-start text-[11px]"
                      >
                        <span className="min-w-0 truncate">{c.listName}</span>
                      </Badge>
                    )}
                    {/* Relative to now, so the server's answer and the
                        browser's can straddle a rounding boundary and differ
                        by a minute. That is a hydration mismatch React logs
                        as an error; the value is the same fact either way. */}
                    <span
                      suppressHydrationWarning
                      className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground"
                    >
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
                    <DropdownMenuTrigger className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1 text-[11px] text-muted-foreground transition-[color,opacity] hover:border-solid hover:text-foreground 2xl:opacity-0 2xl:group-focus-within:opacity-100 2xl:group-hover:opacity-100 2xl:data-[state=open]:opacity-100">
                      <PhoneOutgoing className="size-3" />
                      Log a call
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>
                        Attempt {c.attempts + 1}
                      </DropdownMenuLabel>
                      {loggable.map((o) => (
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
                  {(all.length - shown.length).toLocaleString()} more: work
                  them from the dialler or the spreadsheet.
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* The card under the finger. Fixed to the viewport and pointer-events
          none so `elementFromPoint` sees the column, not the ghost. */}
      {draggingCard && touch.pointer && (
        <div
          className="pointer-events-none fixed z-50 w-[70vw] max-w-[280px] -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-md border border-primary bg-card p-3 shadow-lg"
          style={{ left: touch.pointer.x, top: touch.pointer.y }}
        >
          <p className="truncate text-[13px] font-bold leading-tight">
            {draggingCard.company ?? draggingCard.name ?? draggingCard.phone}
          </p>
          <p className="mt-1 text-[13px] font-bold tabular-nums text-primary">
            {draggingCard.phone}
          </p>
        </div>
      )}

      {playing?.recordingId && (
        <RecordingSheet
          recordingId={playing.recordingId}
          recordingMs={playing.recordingMs}
          title={playing.company ?? playing.name ?? playing.phone}
          subtitle={playing.company ? playing.name : null}
          open
          onOpenChange={(isOpen: boolean) => !isOpen && setPlaying(null)}
        />
      )}
    </div>
  );
}

/** Mirror of `stageOf` in lib/calls for the optimistic move; the server is
 *  still the one that decides, on the next refresh. */
function stageFor(outcome: CallOutcome): CallStage {
  if (outcome === "callback") return "callback";
  if (outcome === "demo_booked") return "demo_booked";
  if (outcome === "trial") return "trial";
  if (outcome === "won") return "won";
  if (outcome === "lost" || outcome === "not_interested" || outcome === "bad_number") {
    return "lost";
  }
  return "tried";
}
