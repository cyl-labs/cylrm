"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderOpen,
  Pencil,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import type { CallCategory, CallOutcome, SheetLead } from "@/lib/calls";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dialableNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";

/** Every row is the same height, which is what lets the grid render only the
 *  slice on screen — see the windowing in `LeadsGrid`. */
const ROW_H = 30;
/** Rows kept rendered above and below the viewport, so a fast scroll or a
 *  keyboard jump lands on a row that already exists. */
const OVERSCAN = 12;

type ColKey =
  | "listName"
  | "company"
  | "category"
  | "phone"
  | "name"
  | "title"
  | "email"
  | "attempts"
  | "lastCalledAt"
  | "callbackAt"
  | "lastNotes";

/* Company then Category first, and both narrow enough that a 390px phone
   shows them without scrolling — seeing what each lead is classified as is
   the whole point of this screen. */
const COLS: { key: ColKey; label: string; w: number; align?: "center" }[] = [
  { key: "company", label: "Company", w: 200 },
  { key: "category", label: "Category", w: 140 },
  { key: "phone", label: "Phone", w: 140 },
  { key: "listName", label: "List", w: 160 },
  { key: "name", label: "Contact", w: 150 },
  { key: "title", label: "Title", w: 160 },
  { key: "email", label: "Email", w: 220 },
  { key: "attempts", label: "Tries", w: 64, align: "center" },
  { key: "lastCalledAt", label: "Last call", w: 130 },
  { key: "callbackAt", label: "Callback", w: 130 },
  { key: "lastNotes", label: "Notes", w: 320 },
];

type EditableKey = "company" | "phone" | "name" | "title" | "email";

/** Columns that are the lead's own record and can be corrected here — a
 *  scraped number is wrong often enough to be worth fixing in place. The rest
 *  are derived: Category has its own dropdown, Tries / Last call / Callback /
 *  Notes come from the calls themselves, and List is which sheet you are on. */
const EDITABLE = new Set<ColKey>([
  "company",
  "phone",
  "name",
  "title",
  "email",
] satisfies EditableKey[]);

const isEditable = (key: ColKey): key is EditableKey => EDITABLE.has(key);

/** A, B, C … — the column names a spreadsheet user reads off the top. */
const colLetter = (i: number) => String.fromCharCode(65 + i);

/**
 * Call times are shown as Singapore times, and the locale is pinned.
 *
 * Not a preference: the calling is done in Singapore, and leaving either to
 * the viewer made every dated cell a hydration mismatch. The server renders
 * this HTML on a droplet running UTC and the browser hydrates it in SGT, so
 * the two disagreed on every row and React threw the tree away and rebuilt
 * it. Fixing the zone makes both sides produce the same string.
 */
const CALL_TZ = "Asia/Singapore";

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: CALL_TZ,
  });
}

/** The cell's value as text — what the formula bar shows, what Ctrl+C copies
 *  and what lands in the CSV, so all three can never disagree. */
function cellText(lead: SheetLead, key: ColKey): string {
  switch (key) {
    case "category":
      return CATEGORY_LABELS[categoryOf(lead)];
    case "attempts":
      return lead.attempts ? String(lead.attempts) : "";
    case "lastCalledAt":
      return fmt(lead.lastCalledAt);
    case "callbackAt":
      return fmt(lead.callbackAt);
    case "phone":
      return lead.phone;
    case "listName":
      return lead.listName;
    default:
      return lead[key] ?? "";
  }
}

function csvCell(value: string) {
  // A leading =, +, - or @ makes Excel treat the cell as a formula, and a
  // number like "+65 6836 1030" is exactly that shape.
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}

type Col = (typeof COLS)[number];

function downloadCsv(rows: SheetLead[], cols: Col[], name: string) {
  const lines = [cols.map((c) => csvCell(c.label)).join(",")];
  for (const l of rows) {
    lines.push(cols.map((c) => csvCell(cellText(l, c.key))).join(","));
  }
  // The BOM is what makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The category cell's editor.
 *
 * Rendered only for the selected cell — a menu per row would be several
 * thousand of them.
 *
 * The menu separates the two things that look alike and are not: **logging a
 * call**, which adds an attempt, and **correcting the last one**, which does
 * not. Ringing a "No answer" lead again and getting no answer again is a
 * second attempt, and the sheet used to have no way to say so — picking the
 * category it already had did nothing at all.
 */
function CategoryMenu({
  lead,
  demo,
  onLogged,
  onCorrected,
}: {
  lead: SheetLead;
  demo: boolean;
  /** A call happened: one more attempt, rung just now. */
  onLogged: (id: number, outcome: CallOutcome) => void;
  /** The last call was mislabelled: same attempt, different outcome. */
  onCorrected: (id: number, category: CallCategory) => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const category = categoryOf(lead);
  const who = lead.company ?? lead.name ?? lead.phone;

  async function log(outcome: CallOutcome) {
    if (saving) return;
    if (demo) {
      toast.success(`${OUTCOME_LABELS[outcome]} — demo, not saved`);
      onLogged(lead.id, outcome);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLeadId: lead.id, outcome }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Could not log it (${res.status}).`);
        return;
      }
      toast.success(
        `${OUTCOME_LABELS[outcome]} — ${who}, attempt ${lead.attempts + 1}`,
      );
      onLogged(lead.id, outcome);
    } catch {
      toast.error("Could not log it — network error.");
    } finally {
      setSaving(false);
    }
  }

  async function correct(next: CallCategory) {
    if (saving || next === category) return;
    if (demo) {
      toast.success(`${CATEGORY_LABELS[next]} — demo, not saved`);
      onCorrected(lead.id, next);
      return;
    }
    setSaving(true);
    try {
      const res =
        next === "uncalled"
          ? await fetch(`/api/calls?callLeadId=${lead.id}`, { method: "DELETE" })
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
      toast.success(`${who} → ${CATEGORY_LABELS[next]}`);
      onCorrected(lead.id, next);
    } catch {
      toast.error("Could not change it — network error.");
    } finally {
      setSaving(false);
    }
  }

  const outcomes = Object.keys(OUTCOME_LABELS) as CallOutcome[];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label="Log a call or change category"
          className="grid size-4 shrink-0 place-items-center rounded-sm bg-primary text-primary-foreground disabled:opacity-50"
        >
          <ChevronDown className="size-3" strokeWidth={2.6} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Logging is the everyday action and sits at the top level;
            correcting a mis-tap is rare and one level in. */}
        <DropdownMenuLabel>
          Log a call{lead.attempts > 0 && ` (attempt ${lead.attempts + 1})`}
        </DropdownMenuLabel>
        {outcomes.map((o) => (
          <DropdownMenuItem key={o} onSelect={() => log(o)}>
            {OUTCOME_LABELS[o]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={category === "uncalled"}>
            Correct the last one
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>Not a new call</DropdownMenuLabel>
            {outcomes.map((o) => (
              <DropdownMenuItem
                key={o}
                disabled={o === category}
                onSelect={() => correct(o)}
              >
                {OUTCOME_LABELS[o]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => correct("uncalled")}>
              Undo — back to never called
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LeadsGrid({
  leads,
  lists,
  initialTab = "all",
  truncated = false,
  demo = false,
}: {
  leads: SheetLead[];
  /** Every niche. `called` decides whether its tab is out on the strip or
   *  folded away under "Not called yet". */
  lists: { id: number; name: string; called: boolean }[];
  /** Which sheet tab to open on — set by `?list=` so the Spreadsheet button
   *  on a call list lands on that list rather than on everything. */
  initialTab?: number | "all";
  /** More leads exist than the sheet loads — said out loud rather than
   *  showing part of a list as if it were all of it. */
  truncated?: boolean;
  demo?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<number | "all">(initialTab);
  // The folder starts open when the sheet was opened on a niche inside it —
  // arriving at a tab hidden in a closed folder looks like the tab has gone.
  const [showUntouched, setShowUntouched] = React.useState(
    initialTab !== "all" && lists.some((l) => l.id === initialTab && !l.called),
  );
  const [category, setCategory] = React.useState<CallCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [sel, setSel] = React.useState({ r: 0, c: 0 });
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH] = React.useState(600);
  // Applied over the server rows so a logged or corrected call shows at once
  // and survives the refresh that follows it.
  const [callEdits, setCallEdits] = React.useState<
    Record<
      number,
      Pick<SheetLead, "lastOutcome" | "attempts" | "lastCalledAt" | "callbackAt">
    >
  >({});
  /** The lead whose number was just copied, so its cell can say so. */
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  /** Corrected field values, laid over the server rows the same way category
   *  edits are, so a fix is on screen before the refresh comes back. */
  const [fieldEdits, setFieldEdits] = React.useState<
    Record<number, Partial<Pick<SheetLead, EditableKey>>>
  >({});
  /** The cell being edited and its draft text; null when nothing is. */
  const [editing, setEditing] = React.useState<{
    leadId: number;
    key: EditableKey;
  } | null>(null);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const editInputRef = React.useRef<HTMLInputElement>(null);
  const activeTabRef = React.useRef<HTMLButtonElement>(null);

  // Arriving on a list's tab from its Spreadsheet button, that tab can be far
  // along a row of fifteen. Mount-only: later switches come from a tab the
  // user just clicked, which is on screen by definition.
  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  const rows = React.useMemo(
    () =>
      leads.map((base) => {
        const fields = fieldEdits[base.id];
        const withFields = fields ? { ...base, ...fields } : base;
        const call = callEdits[base.id];
        return call ? { ...withFields, ...call } : withFields;
      }),
    [leads, callEdits, fieldEdits],
  );

  const inTab = React.useMemo(
    () => (tab === "all" ? rows : rows.filter((l) => l.listId === tab)),
    [rows, tab],
  );

  /* One list's tab drops the List column: every row on it says the same
     thing, and on a phone it is 160px in front of the company name. */
  const cols = React.useMemo(
    () => (tab === "all" ? COLS : COLS.filter((c) => c.key !== "listName")),
    [tab],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return inTab.filter((l) => {
      if (category !== "all" && categoryOf(l) !== category) return false;
      if (q === "") return true;
      return cols.some((c) => cellText(l, c.key).toLowerCase().includes(q));
    });
  }, [inTab, cols, category, search]);

  /** Counts for the category picker, over the current tab only — the number
   *  beside a category should match what picking it shows. */
  const counts = React.useMemo(() => {
    const map = new Map<CallCategory, number>();
    for (const l of inTab) {
      const c = categoryOf(l);
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return map;
  }, [inTab]);

  // Clamped at render rather than reset in an effect, so narrowing the filter
  // under the cursor leaves it on the last row instead of nowhere.
  const selR = Math.min(sel.r, Math.max(filtered.length - 1, 0));
  const selected = filtered[selR];
  const selCol = cols[Math.min(sel.c, cols.length - 1)];

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN,
  );
  const visible = filtered.slice(start, end);

  /** Blank rows padding the grid out to the bottom of the window. Numbering
   *  carries on from the data, the way a spreadsheet's does. */
  const fillerRows = React.useMemo(() => {
    const headerH = ROW_H + 24;
    const short = Math.ceil((viewH - headerH) / ROW_H) - filtered.length;
    return short <= 0
      ? []
      : Array.from({ length: short }, (_, i) => filtered.length + i + 2);
  }, [viewH, filtered.length]);

  /** Keep the cursor on screen after a keyboard move. */
  const revealRow = React.useCallback((r: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    // The two frozen header rows sit over the top of the scroller, so a row
    // level with them is technically visible and actually hidden.
    const headerH = ROW_H + 24;
    const top = r * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH) {
      el.scrollTop = top + ROW_H - el.clientHeight + headerH;
    }
  }, []);

  function move(dr: number, dc: number) {
    const r = Math.min(Math.max(selR + dr, 0), Math.max(filtered.length - 1, 0));
    const c = Math.min(Math.max(sel.c + dc, 0), cols.length - 1);
    setSel({ r, c });
    revealRow(r);
  }

  async function copy(text: string, leadId?: number, phone = false) {
    if (text === "") return;
    try {
      // A number goes to the clipboard without its country code, ready for a
      // Singapore keypad; every other cell copies exactly what it shows.
      await navigator.clipboard.writeText(
        phone ? dialableNumber(text) : text.trim(),
      );
      if (leadId === undefined) toast.success("Copied");
      else {
        // The number cell says "Copied" in place rather than raising a toast:
        // working a list is one copy after another, and a toast per number
        // would spend the whole session covering the grid.
        setCopiedId(leadId);
        setTimeout(
          () => setCopiedId((id) => (id === leadId ? null : id)),
          1600,
        );
      }
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  function copySelection() {
    if (selected) {
      copy(cellText(selected, selCol.key), undefined, selCol.key === "phone");
    }
  }

  const canEdit = selected !== undefined && isEditable(selCol.key);

  function startEditing() {
    if (!selected || !isEditable(selCol.key)) return;
    setEditing({ leadId: selected.id, key: selCol.key });
    setDraft(cellText(selected, selCol.key));
    // The input mounts this tick; focusing after paint puts the caret in it
    // without the grid stealing it back.
    requestAnimationFrame(() => editInputRef.current?.select());
  }

  function cancelEditing() {
    setEditing(null);
    setDraft("");
    scrollerRef.current?.focus();
  }

  /**
   * Write the edited cell back to the lead.
   *
   * The server is the judge of whether the value is allowed — a number that
   * cannot be rung in Singapore, or one already on this list, comes back as an
   * error and the draft stays open so it can be fixed rather than lost.
   */
  async function saveEdit() {
    if (!editing || saving) return;
    const target = rows.find((l) => l.id === editing.leadId);
    const next = draft.trim();
    if (!target || next === cellText(target, editing.key)) {
      cancelEditing();
      return;
    }
    if (demo) {
      toast.success("Demo — not saved");
      setFieldEdits((prev) => ({
        ...prev,
        [editing.leadId]: { ...prev[editing.leadId], [editing.key]: next || null },
      }));
      cancelEditing();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/call-leads/${editing.leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [editing.key]: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Could not save (${res.status}).`);
        return;
      }
      setFieldEdits((prev) => ({
        ...prev,
        [editing.leadId]: {
          ...prev[editing.leadId],
          // What the server stored, not what was typed — it trims, and a
          // cleared cell comes back as null.
          [editing.key]: data[editing.key] ?? null,
        },
      }));
      toast.success("Saved");
      cancelEditing();
      router.refresh();
    } catch {
      toast.error("Could not save — network error.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const rowsPerPage = Math.max(Math.floor(viewH / ROW_H) - 1, 1);
    switch (e.key) {
      case "ArrowDown":
        move(1, 0);
        break;
      case "ArrowUp":
        move(-1, 0);
        break;
      case "ArrowRight":
      case "Tab":
        move(0, e.shiftKey && e.key === "Tab" ? -1 : 1);
        break;
      case "ArrowLeft":
        move(0, -1);
        break;
      case "PageDown":
        move(rowsPerPage, 0);
        break;
      case "PageUp":
        move(-rowsPerPage, 0);
        break;
      case "Home":
        setSel({ r: 0, c: 0 });
        revealRow(0);
        break;
      case "End":
        move(filtered.length, 0);
        break;
      case "c":
        if (e.metaKey || e.ctrlKey) copySelection();
        else return;
        break;
      // Enter and F2 open the editor, as they do in a spreadsheet.
      case "Enter":
      case "F2":
        if (!canEdit) return;
        startEditing();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** A call was logged: one more attempt, and it happened just now. */
  function handleLogged(id: number, outcome: CallOutcome) {
    const current = rows.find((l) => l.id === id);
    setCallEdits((prev) => ({
      ...prev,
      [id]: {
        lastOutcome: outcome,
        attempts: (current?.attempts ?? 0) + 1,
        lastCalledAt: new Date().toISOString(),
        // Logged from here a callback carries no time, and the API defaults it
        // to tomorrow — mirrored so the cell does not flash the old date until
        // the refresh lands. Pick the time on the dialler if it matters.
        callbackAt:
          outcome === "callback"
            ? new Date(Date.now() + 86_400_000).toISOString()
            : null,
      },
    }));
    if (!demo) router.refresh();
  }

  /** The last call was mislabelled — same attempt, different outcome. */
  function handleCorrected(id: number, next: CallCategory) {
    const current = rows.find((l) => l.id === id);
    setCallEdits((prev) => ({
      ...prev,
      [id]: {
        lastOutcome: next === "uncalled" ? null : next,
        attempts:
          next === "uncalled"
            ? Math.max((current?.attempts ?? 1) - 1, 0)
            : (current?.attempts ?? 1),
        lastCalledAt: next === "uncalled" ? null : (current?.lastCalledAt ?? null),
        callbackAt: next === "callback" ? (current?.callbackAt ?? null) : null,
      },
    }));
    if (!demo) router.refresh();
  }

  const asTab = (l: { id: number; name: string }) => ({
    key: l.id as number | "all",
    label: l.name,
    count: rows.filter((r) => r.listId === l.id).length,
  });
  const tabs = [
    { key: "all" as number | "all", label: "All leads", count: rows.length },
    ...lists.filter((l) => l.called).map(asTab),
  ];
  const untouched = lists.filter((l) => !l.called).map(asTab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v as CallCategory | "all");
            setSel({ r: 0, c: sel.c });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]} ({counts.get(c) ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSel({ r: 0, c: sel.c });
          }}
          placeholder="Search this sheet…"
          className="h-8 w-full text-[13px] sm:w-64"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              filtered,
              cols,
              tabs.find((t) => t.key === tab)?.label ?? "call-leads",
            )
          }
        >
          <Download data-icon="inline-start" />
          Export CSV
        </Button>
        <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">
          {filtered.length.toLocaleString()} rows
          {truncated && " (first 5,000)"}
        </span>
      </div>

      {/* Formula bar: the selected cell's reference and its full value, which
          is how a long note is read without widening the column. */}
      <div className="flex items-center gap-2 border-b bg-card px-3 py-1.5">
        <span className="w-16 shrink-0 rounded border px-1.5 py-0.5 text-center text-[12px] font-semibold tabular-nums">
          {selected ? `${colLetter(sel.c)}${selR + 2}` : "—"}
        </span>
        <span className="text-[13px] font-semibold text-muted-foreground">
          fx
        </span>
        {editing ? (
          <input
            ref={editInputRef}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              else if (e.key === "Escape") cancelEditing();
              else return;
              e.preventDefault();
            }}
            className="min-w-0 flex-1 rounded border border-primary bg-background px-2 py-0.5 text-[13px] outline-none disabled:opacity-60"
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[13px]"
            onDoubleClick={startEditing}
          >
            {selected ? cellText(selected, selCol.key) : ""}
          </span>
        )}
        {editing ? (
          <>
            <Button
              size="sm"
              className="h-7 shrink-0"
              disabled={saving}
              onClick={saveEdit}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0"
              disabled={saving}
              onClick={cancelEditing}
            >
              Cancel
            </Button>
          </>
        ) : (
          selected && (
            <>
              {/* Only the lead's own fields; the derived columns say why they
                  cannot be typed over rather than failing silently. */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0"
                disabled={!canEdit}
                title={
                  canEdit
                    ? "Edit this cell (Enter)"
                    : "This column comes from the calls themselves"
                }
                onClick={startEditing}
              >
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0"
                onClick={copySelection}
              >
                <Copy data-icon="inline-start" />
                Copy
              </Button>
            </>
          )
        )}
      </div>

      {/* Grid */}
      <div
        ref={scrollerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto bg-muted/30 outline-none"
      >
        <table
          className="table-fixed border-separate border-spacing-0 text-[13px]"
          style={{ width: 44 + cols.reduce((sum, c) => sum + c.w, 0) }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            {cols.map((c) => (
              <col key={c.key} style={{ width: c.w }} />
            ))}
          </colgroup>
          <thead>
            {/* Column letters, then the header row — a sheet where row 1 holds
                the field names, which is what an exported CSV looks like. */}
            <tr>
              <th
                className="sticky left-0 top-0 z-30 h-6 border-b border-r bg-muted"
                scope="col"
              />
              {cols.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-20 h-6 border-b border-r text-center text-[11px] font-semibold",
                    i === sel.c
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {colLetter(i)}
                </th>
              ))}
            </tr>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-6 z-30 border-b border-r bg-muted text-center text-[11px] font-semibold text-muted-foreground"
                style={{ height: ROW_H }}
              >
                1
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="sticky top-6 z-20 truncate border-b border-r bg-card px-2 text-left font-bold"
                  style={{ height: ROW_H }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length + 1}
                  className="border-b bg-card px-3 py-10 text-center text-muted-foreground"
                >
                  Nothing matches this filter.
                </td>
              </tr>
            ) : (
              <>
                {start > 0 && (
                  <tr style={{ height: start * ROW_H }} aria-hidden>
                    <td colSpan={cols.length + 1} className="bg-card p-0" />
                  </tr>
                )}
                {visible.map((l, i) => {
                  const r = start + i;
                  const isSelRow = r === selR;
                  return (
                    <tr key={l.id} style={{ height: ROW_H }}>
                      <td
                        className={cn(
                          "sticky left-0 z-10 border-b border-r text-center text-[11px] tabular-nums",
                          isSelRow
                            ? "bg-primary/15 font-semibold text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r + 2}
                      </td>
                      {cols.map((c, ci) => {
                        const isSel = isSelRow && ci === sel.c;
                        return (
                          <td
                            key={c.key}
                            onClick={() => {
                              setSel({ r, c: ci });
                              // A number cell copies on the click that selects
                              // it: the number exists to be dialled on a
                              // handset, and that is what the dialler's big
                              // button does too.
                              if (c.key === "phone") copy(l.phone, l.id, true);
                            }}
                            onDoubleClick={() => {
                              // Double-click opens the editor, as in a
                              // spreadsheet. The single click that precedes it
                              // has already selected this cell.
                              if (isEditable(c.key)) {
                                setEditing({ leadId: l.id, key: c.key });
                                setDraft(cellText(l, c.key));
                                requestAnimationFrame(() =>
                                  editInputRef.current?.select(),
                                );
                              }
                            }}
                            title={c.key === "phone" ? "Click to copy" : undefined}
                            className={cn(
                              "relative cursor-cell truncate border-b border-r bg-card px-2",
                              c.key === "phone" && "group/cell cursor-copy",
                              c.align === "center" && "text-center",
                              c.key === "attempts" && "tabular-nums",
                              (c.key === "lastCalledAt" ||
                                c.key === "callbackAt" ||
                                c.key === "title" ||
                                c.key === "email") &&
                                "text-muted-foreground",
                              isSel &&
                                "outline outline-2 -outline-offset-2 outline-primary",
                              isSelRow && !isSel && "bg-primary/[0.06]",
                            )}
                          >
                            {c.key === "category" ? (
                              <span className="flex items-center gap-1">
                                <Badge
                                  variant={categoryTone(categoryOf(l))}
                                  className="min-w-0 truncate"
                                >
                                  {CATEGORY_LABELS[categoryOf(l)]}
                                </Badge>
                                {isSel && (
                                  <CategoryMenu
                                    lead={l}
                                    demo={demo}
                                    onLogged={handleLogged}
                                    onCorrected={handleCorrected}
                                  />
                                )}
                              </span>
                            ) : c.key === "phone" ? (
                              <span
                                className={cn(
                                  "flex items-center gap-1.5 tabular-nums",
                                  copiedId === l.id && "font-semibold text-success",
                                )}
                              >
                                {copiedId === l.id ? (
                                  <>
                                    <Check className="size-3.5 shrink-0" strokeWidth={2.6} />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    {l.phone}
                                    <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/cell:opacity-50" />
                                  </>
                                )}
                              </span>
                            ) : (
                              cellText(l, c.key)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {end < filtered.length && (
                  <tr style={{ height: (filtered.length - end) * ROW_H }} aria-hidden>
                    <td colSpan={cols.length + 1} className="bg-card p-0" />
                  </tr>
                )}
              </>
            )}
            {/* Empty rows under the data, so a short list still looks like a
                sheet rather than a table floating on a background. */}
            {fillerRows.map((r) => (
              <tr key={`filler-${r}`} style={{ height: ROW_H }} aria-hidden>
                <td className="sticky left-0 z-10 border-b border-r bg-muted text-center text-[11px] tabular-nums text-muted-foreground">
                  {r}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="border-b border-r bg-card" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs — one per call list, the way a workbook holds a sheet per
          table. Filtering happens in the browser, so switching is instant. */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t bg-card px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={String(t.key)}
            ref={t.key === tab ? activeTabRef : undefined}
            type="button"
            onClick={() => {
              setTab(t.key);
              setSel({ r: 0, c: 0 });
              if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
            }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1 text-[13px] transition-colors",
              t.key === tab
                ? "border-primary bg-primary/10 font-bold text-primary"
                : "border-transparent font-medium text-muted-foreground hover:bg-muted",
            )}
          >
            <Table2 className="size-3.5" strokeWidth={1.9} />
            {t.label}
            <span className="tabular-nums opacity-60">{t.count}</span>
          </button>
        ))}

        {/* The niches nobody has rung, folded rather than dropped: they are
            how a new one gets started, but sixteen tabs made the strip
            something to scroll past instead of read. */}
        {untouched.length > 0 && (
          <button
            type="button"
            onClick={() => setShowUntouched((open) => !open)}
            aria-expanded={showUntouched}
            className="flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            {showUntouched ? (
              <FolderOpen className="size-3.5" strokeWidth={1.9} />
            ) : (
              <Folder className="size-3.5" strokeWidth={1.9} />
            )}
            Not called yet
            <span className="tabular-nums opacity-60">{untouched.length}</span>
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                showUntouched && "rotate-90",
              )}
            />
          </button>
        )}

        {showUntouched &&
          untouched.map((t) => (
            <button
              key={String(t.key)}
              ref={t.key === tab ? activeTabRef : undefined}
              type="button"
              onClick={() => {
                setTab(t.key);
                setSel({ r: 0, c: 0 });
                if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
              }}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1 text-[13px] transition-colors",
                t.key === tab
                  ? "border-primary bg-primary/10 font-bold text-primary"
                  : "border-transparent font-medium text-muted-foreground/80 hover:bg-muted",
              )}
            >
              <Table2 className="size-3.5" strokeWidth={1.9} />
              {t.label}
              <span className="tabular-nums opacity-60">{t.count}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
