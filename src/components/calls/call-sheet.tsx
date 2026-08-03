"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import type { CallCategory, CallOutcome, QueueLead } from "@/lib/calls";
import {
  CALL_CATEGORIES,
  categoryOf,
  CATEGORY_LABELS,
  categoryTone,
  OUTCOME_LABELS,
} from "@/components/calls/outcome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

/** Cells are nowrap so columns line up like a spreadsheet; the grid scrolls
 *  sideways inside its own box rather than widening the page. */
const CELL =
  "border-b border-r px-2.5 py-1.5 text-[13px] whitespace-nowrap align-middle";

/** Category is second on purpose: on a phone only the first columns are on
 *  screen, and seeing what each lead is classified as is the point of this
 *  view. Everything else can be scrolled to. */
const COLUMNS = [
  "Company",
  "Category",
  "Phone",
  "Contact",
  "Title",
  "Email",
  "Tries",
  "Last call",
  "Callback",
  "Notes",
] as const;

function fmt(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function csvCell(value: string) {
  // Leading =, +, - or @ turn a cell into a formula when Excel opens the file;
  // a phone like "+65 6836 1030" is exactly that shape, so it gets quoted with
  // a leading apostrophe rather than evaluated.
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: QueueLead[], listName: string) {
  const header = [...COLUMNS];
  const lines = [header.map(csvCell).join(",")];
  for (const l of rows) {
    lines.push(
      [
        l.company ?? "",
        CATEGORY_LABELS[categoryOf(l)],
        l.phone,
        l.name ?? "",
        l.title ?? "",
        l.email ?? "",
        String(l.attempts),
        l.lastCalledAt ? fmt(l.lastCalledAt) : "",
        l.callbackAt ? fmt(l.callbackAt) : "",
        (l.lastNotes ?? "").replace(/\s+/g, " "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // The BOM is what makes Excel read it as UTF-8 rather than mangling accents.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${listName.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function PhoneCell({ phone }: { phone: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${phone}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(phone.trim());
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Could not copy — select the number and copy it.");
        }
      }}
      className={cn(
        "group flex items-center gap-1.5 tabular-nums",
        copied ? "text-success" : "hover:text-primary",
      )}
    >
      {phone}
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.4} />
      ) : (
        <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}

/**
 * The category cell, which is also how a category is corrected.
 *
 * Picking a new one rewrites the lead's last call rather than logging another,
 * so fixing a mis-tap does not leave the lead looking like it was rung twice.
 */
function CategoryCell({
  lead,
  demo,
  onChanged,
}: {
  lead: QueueLead;
  demo: boolean;
  onChanged: (id: number, category: CallCategory) => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const category = categoryOf(lead);

  async function set(next: CallCategory) {
    if (saving || next === category) return;
    if (demo) {
      toast.success(`${CATEGORY_LABELS[next]} — demo, not saved`);
      onChanged(lead.id, next);
      return;
    }
    setSaving(true);
    try {
      const res =
        next === "uncalled"
          ? await fetch(`/api/calls?callLeadId=${lead.id}`, {
              method: "DELETE",
            })
          : await fetch("/api/calls", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                callLeadId: lead.id,
                outcome: next as CallOutcome,
              }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Could not change it (${res.status}).`);
        return;
      }
      toast.success(
        `${lead.company ?? lead.phone} → ${CATEGORY_LABELS[next]}`,
      );
      onChanged(lead.id, next);
    } catch {
      toast.error("Could not change it — network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="flex items-center gap-1 disabled:opacity-50"
        >
          <Badge variant={categoryTone(category)}>
            {CATEGORY_LABELS[category]}
          </Badge>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Change category</DropdownMenuLabel>
        {(Object.keys(OUTCOME_LABELS) as CallOutcome[]).map((o) => (
          <DropdownMenuItem key={o} onSelect={() => set(o)}>
            {OUTCOME_LABELS[o]}
            {o === category && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={category === "uncalled"}
          onSelect={() => set("uncalled")}
        >
          Back to never called
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CallSheet({
  leads,
  listName,
  truncated = false,
  demo = false,
}: {
  leads: QueueLead[];
  listName: string;
  /** The list is longer than the sheet's ceiling — say so rather than
   *  presenting a partial sheet as the whole list. */
  truncated?: boolean;
  demo?: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = React.useState<CallCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);
  // Applied on top of the server rows so a corrected category shows instantly
  // and survives the refresh that follows.
  const [edits, setEdits] = React.useState<Record<number, CallCategory>>({});

  const rows = React.useMemo(
    () =>
      leads.map((l) => {
        const edited = edits[l.id];
        if (!edited || edited === categoryOf(l)) return l;
        return {
          ...l,
          lastOutcome: edited === "uncalled" ? null : edited,
          callbackAt: edited === "callback" ? l.callbackAt : null,
        };
      }),
    [leads, edits],
  );

  const counts = React.useMemo(() => {
    const map = new Map<CallCategory, number>();
    for (const l of rows) {
      const c = categoryOf(l);
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((l) => {
      if (category !== "all" && categoryOf(l) !== category) return false;
      if (q === "") return true;
      return [l.company, l.name, l.title, l.email, l.phone, l.lastNotes].some(
        (v) => (v ?? "").toLowerCase().includes(q),
      );
    });
  }, [rows, category, search]);

  // Clamped at render rather than reset in an effect, so narrowing the filter
  // while on a high page falls back to the last page instead of an empty one.
  const pageCount = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const safePage = Math.min(pageIndex, pageCount - 1);
  const page = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function handleChanged(id: number, next: CallCategory) {
    setEdits((prev) => ({ ...prev, [id]: next }));
    if (!demo) router.refresh();
  }

  if (leads.length === 0) {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold">Nothing on this list yet.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Import a CSV with a phone column to start.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {(["all", ...CALL_CATEGORIES] as const).map((c) => {
          const count = c === "all" ? rows.length : (counts.get(c) ?? 0);
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c);
                setPageIndex(0);
              }}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                c === category
                  ? "bg-primary/10 text-primary"
                  : count === 0
                    ? "text-muted-foreground/50 hover:bg-muted"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {c === "all" ? "All" : CATEGORY_LABELS[c]}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPageIndex(0);
          }}
          placeholder="Search company, name, number, notes…"
          className="h-8 w-full text-[13px] sm:w-72"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              filtered,
              category === "all"
                ? listName
                : `${listName}-${CATEGORY_LABELS[category]}`,
            )
          }
        >
          <Download data-icon="inline-start" />
          Export CSV
        </Button>
        <span className="ml-auto text-[13px] text-muted-foreground">
          {filtered.length.toLocaleString()}
          {filtered.length === rows.length
            ? " leads"
            : ` of ${rows.length.toLocaleString()}`}
        </span>
      </div>

      <div className="min-w-0 overflow-auto rounded-lg border max-h-[calc(100dvh-19rem)]">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                className={cn(
                  CELL,
                  "sticky left-0 z-20 w-10 bg-muted text-center text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                )}
              >
                #
              </th>
              {COLUMNS.map((label) => (
                <th
                  key={label}
                  className={cn(
                    CELL,
                    "bg-muted text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="border-b px-3 py-10 text-center text-[13px] text-muted-foreground"
                >
                  No leads in this category.
                </td>
              </tr>
            ) : (
              page.map((l, i) => (
                <tr key={l.id} className="group even:bg-muted/25">
                  <td
                    className={cn(
                      CELL,
                      "sticky left-0 z-10 bg-card text-center text-[11px] tabular-nums text-muted-foreground group-even:bg-muted/25",
                    )}
                  >
                    {safePage * PAGE_SIZE + i + 1}
                  </td>
                  {/* Narrow on a phone so the category beside it stays on
                      screen without scrolling. */}
                  <td
                    className={cn(
                      CELL,
                      "max-w-[9rem] truncate font-medium sm:max-w-[16rem]",
                    )}
                  >
                    {l.company ?? ""}
                  </td>
                  <td className={CELL}>
                    <CategoryCell
                      lead={l}
                      demo={demo}
                      onChanged={handleChanged}
                    />
                  </td>
                  <td className={CELL}>
                    <PhoneCell phone={l.phone} />
                  </td>
                  <td className={cn(CELL, "max-w-[12rem] truncate")}>
                    {l.name ?? ""}
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "max-w-[12rem] truncate text-muted-foreground",
                    )}
                  >
                    {l.title ?? ""}
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "max-w-[14rem] truncate text-muted-foreground",
                    )}
                  >
                    {l.email ?? ""}
                  </td>
                  <td className={cn(CELL, "text-center tabular-nums")}>
                    {l.attempts || ""}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {fmt(l.lastCalledAt)}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {fmt(l.callbackAt)}
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "max-w-[20rem] truncate text-muted-foreground",
                    )}
                    title={l.lastNotes ?? undefined}
                  >
                    {l.lastNotes ?? ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        {truncated && (
          <span>
            Showing the first {rows.length.toLocaleString()} leads on this list.
          </span>
        )}
        {pageCount > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums">
              Page {safePage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPageIndex(safePage - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPageIndex(safePage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
