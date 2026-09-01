"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import type { CallRegion } from "@/lib/calls";
import { REGION_LABELS, REGION_ORDER } from "@/components/calls/region";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Import one CSV or twenty, and set up each list before it exists.
 *
 * Pick the files, and every one is parsed by the server *without being
 * written* — so the review step can say what each actually holds before
 * anybody commits. Name, folder and owner are set per list there, which is the
 * whole point: importing fifteen niches and then opening fifteen cards to
 * assign each one was the tedious part.
 *
 * Nothing is created until Import is pressed. Removing a file from the review
 * list therefore costs nothing and leaves nothing behind.
 */

type Scan = {
  usable: number;
  /** Usable rows whose number the CRM already holds, anywhere. */
  duplicatesInCrm: number;
  /** Where those copies sit, biggest first — the answer to "already where?". */
  duplicateLists: { name: string; count: number }[];
  otherListCount: number;
  skippedNoPhone: number;
  skippedRepeatedInFile: number;
  skippedBadNumber: { company: string; phone: string }[];
};

type Staged = {
  /** Stable across re-renders; two files can share a name. */
  key: string;
  file: File;
  name: string;
  region: CallRegion | "none";
  ownerId: string;
  /** Drop the rows the CRM already has instead of storing them flagged. */
  dropDuplicates: boolean;
  /** How many lists this file becomes. 1 is the ordinary import. */
  split: number;
  /** One owner per part, only read when split > 1. */
  partOwnerIds: string[];
  scan: Scan | null;
  /** Why this file cannot be imported, from the server's own parser. */
  error: string | null;
};

type ImportResult = {
  callListName: string;
  appended: boolean;
  inserted: number;
  duplicates: number;
  removedDuplicates: number;
  alreadyInList: number;
  skippedNoPhone: number;
  skippedRepeatedInFile: number;
  skippedBadNumber: { company: string; phone: string }[];
};

const NEW_LIST = "__new__";
const NO_OWNER = "__none__";
const MAX_SPLIT = 10;

/** Sizes of each part when `total` rows are dealt `split` ways. Dealing round
 *  robin makes them equal to within one row, which is what this reproduces —
 *  it is a preview of the server's own arithmetic, not a second rule. */
function partSizes(total: number, split: number) {
  return Array.from(
    { length: split },
    (_, i) => Math.floor(total / split) + (i < total % split ? 1 : 0),
  );
}

function nameFromFilename(filename: string) {
  return filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
}

/** The suffix every existing list already carries, so a file called
 *  "movers-sg.csv" lands in the right folder without being told. */
function guessRegion(name: string): CallRegion | "none" {
  const t = name.toLowerCase();
  if (/\b(sg|singapore)\b/.test(t)) return "sg";
  if (/\b(us|usa|united states)\b/.test(t)) return "us";
  if (/\b(uk|gb|britain|united kingdom)\b/.test(t)) return "gb";
  return "none";
}

export function CallImportDialog({
  callLists,
  people = [],
  canAssign = false,
}: {
  callLists: { id: number; name: string }[];
  /** Who a list can be handed to. Empty for a caller, who cannot assign. */
  people?: { id: number; name: string; active: boolean }[];
  canAssign?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [staged, setStaged] = React.useState<Staged[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const [target, setTarget] = React.useState<string>(NEW_LIST);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<ImportResult[] | null>(null);

  // Appending only makes sense for a single file: five files into one list is
  // a merge nobody asked for, and it would hide which rows came from where.
  const appending = staged.length === 1 && target !== NEW_LIST;

  function reset() {
    setStaged([]);
    setScanning(false);
    setTarget(NEW_LIST);
    setSubmitting(false);
    setError(null);
    setResults(null);
  }

  /**
   * Ask the server what is in a file, reading it in the given market.
   *
   * Re-run whenever the folder changes, because the folder is what decides
   * how a number written without a country code is read: the same US file is
   * four usable rows as Unfiled and 278 as United States.
   */
  const scanFile = React.useCallback(
    async (key: string, file: File, region: CallRegion | "none") => {
      setStaged((prev) =>
        prev.map((s) => (s.key === key ? { ...s, scan: null, error: null } : s)),
      );
      const body = new FormData();
      body.append("file", file);
      body.append("dryRun", "1");
      if (region !== "none") body.append("region", region);
      try {
        const res = await fetch("/api/call-lists", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        setStaged((prev) =>
          prev.map((s) =>
            s.key === key
              ? res.ok
                ? { ...s, scan: data as Scan, error: null }
                : { ...s, scan: null, error: data.error ?? "Could not read it." }
              : s,
          ),
        );
      } catch {
        setStaged((prev) =>
          prev.map((s) =>
            s.key === key
              ? { ...s, scan: null, error: "Could not read it." }
              : s,
          ),
        );
      }
    },
    [],
  );

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // The same input can be used twice; clearing it means re-picking the same
    // file fires change again rather than silently doing nothing.
    e.target.value = "";
    if (picked.length === 0) return;
    setError(null);

    const additions: Staged[] = picked.map((file, i) => {
      const name = nameFromFilename(file.name);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        file,
        name,
        region: guessRegion(name),
        ownerId: NO_OWNER,
        // On by default: a number the CRM already holds is one nobody should
        // ring again, and storing it flagged only leaves it to be counted.
        dropDuplicates: true,
        split: 1,
        partOwnerIds: [],
        scan: null,
        error: null,
      };
    });
    setStaged((prev) => [...prev, ...additions]);

    setScanning(true);
    // Sequential rather than all at once: a bulk import is a dozen files on a
    // 1 vCPU box, and parsing them in parallel is how the other apps on it
    // notice. Each result lands as it arrives.
    for (const entry of additions) {
      await scanFile(entry.key, entry.file, entry.region);
    }
    setScanning(false);
  }

  function update(key: string, patch: Partial<Staged>) {
    setStaged((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }

  // What will actually be written: usable rows, less the ones the CRM already
  // has when they are being dropped. This is the number the split is dealt
  // from, so it is the one the screen counts with.
  const toImport = (s: Staged) =>
    s.scan === null
      ? 0
      : s.scan.usable - (s.dropDuplicates ? s.scan.duplicatesInCrm : 0);

  // Staged but not importable: a file whose numbers are all national format
  // reads as zero usable until a folder is chosen, and it has to stay on
  // screen with its controls for that to be possible. So does one whose every
  // number the CRM already holds — unticking the box is the way forward there.
  const importable = staged.filter((s) => s.error === null && toImport(s) > 0);
  const scanned = staged.filter((s) => s.error === null && s.scan !== null);
  const empty = scanned.filter((s) => toImport(s) === 0);
  const ready =
    importable.length > 0 &&
    !scanning &&
    (appending || importable.every((s) => s.name.trim() !== ""));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);

    const done: ImportResult[] = [];
    try {
      // One at a time, so a list that fails does not take the rest with it and
      // the ones already created stay created.
      for (const s of importable) {
        const body = new FormData();
        body.append("file", s.file);
        if (s.dropDuplicates) body.append("dropDuplicates", "1");
        if (appending) {
          body.append("callListId", target);
        } else {
          body.append("name", s.name.trim());
          if (s.region !== "none") body.append("region", s.region);
          if (s.split > 1) {
            body.append("split", String(s.split));
            // One field per part, in order, so a part with nobody on it is
            // still a position rather than a gap.
            for (let i = 0; i < s.split; i++) {
              const owner = s.partOwnerIds[i] ?? NO_OWNER;
              body.append("partOwnerId", owner === NO_OWNER ? "" : owner);
            }
          } else if (s.ownerId !== NO_OWNER) {
            body.append("assignedUserId", s.ownerId);
          }
        }
        const res = await fetch("/api/call-lists", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            `${s.name || s.file.name}: ${data.error ?? `failed (${res.status})`}` +
              (done.length ? ` — ${done.length} imported before this.` : ""),
          );
          break;
        }
        // A split comes back as the set of lists it made; everything else is
        // one list, the shape this has always returned.
        if (Array.isArray(data.parts)) done.push(...(data.parts as ImportResult[]));
        else done.push(data as ImportResult);
      }
      if (done.length > 0) {
        setResults(done);
        router.refresh();
      }
    } catch {
      setError("Import failed: network error.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  const totalUsable = importable.reduce((a, s) => a + toImport(s), 0);
  const totalLists = importable.reduce((a, s) => a + (appending ? 1 : s.split), 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload data-icon="inline-start" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          staged.length > 0 || results ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        {results ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {results.length === 1
                  ? results[0].appended
                    ? `Added to “${results[0].callListName}”`
                    : `“${results[0].callListName}” created`
                  : `${results.length} lists created`}
              </DialogTitle>
              <DialogDescription>
                {results.reduce((a, r) => a + r.inserted, 0)} leads imported.
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y text-[13px]">
              {results.map((r) => (
                <li key={r.callListName} className="py-2">
                  <p className="font-semibold">{r.callListName}</p>
                  <p className="text-muted-foreground">
                    {r.inserted} imported
                    {r.removedDuplicates > 0 &&
                      ` · ${r.removedDuplicates} removed, already in the CRM`}
                    {r.duplicates > 0 &&
                      ` · ${r.duplicates} already on another list, held out of the queue`}
                    {r.alreadyInList > 0 && ` · ${r.alreadyInList} already here`}
                    {r.skippedRepeatedInFile > 0 &&
                      ` · ${r.skippedRepeatedInFile} repeated in the file`}
                    {r.skippedNoPhone > 0 && ` · ${r.skippedNoPhone} with no number`}
                    {r.skippedBadNumber.length > 0 &&
                      ` · ${r.skippedBadNumber.length} unusable numbers`}
                  </p>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Import call lists</DialogTitle>
              <DialogDescription>
                CSVs with a phone column. Pick as many as you like — each
                becomes its own list, and nothing is created until you press
                Import.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="call-import-file">
                  {staged.length > 0 ? "Add more files" : "CSV files"}
                </Label>
                <Input
                  id="call-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  onChange={handleFileChange}
                />
              </div>

              {staged.length === 1 && callLists.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="call-import-target">Call list</Label>
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger id="call-import-target" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_LIST}>Create a new list</SelectItem>
                      {callLists.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          Add to: {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {staged.length > 0 && (
                <ul className="space-y-2">
                  {staged.map((s) => {
                    // The key carries the filename, so it holds dots and
                    // spaces; an id is not the place for either.
                    const domId = s.key.replace(/[^a-zA-Z0-9]+/g, "-");
                    return (
                    <li
                      key={s.key}
                      className={cn(
                        "rounded-lg border p-3",
                        s.error && "border-destructive/40 bg-destructive/5",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] text-muted-foreground">
                            {s.file.name}
                          </p>
                          {s.error ? (
                            <p className="mt-0.5 text-[13px] text-destructive">
                              {s.error}
                            </p>
                          ) : s.scan ? (
                            <>
                              <p className="mt-0.5 text-[13px]">
                                <span className="font-semibold">
                                  {s.scan.usable}
                                </span>{" "}
                                usable
                                {s.scan.skippedBadNumber.length > 0 &&
                                  ` · ${s.scan.skippedBadNumber.length} unusable`}
                                {s.scan.skippedNoPhone > 0 &&
                                  ` · ${s.scan.skippedNoPhone} with no number`}
                                {s.scan.skippedRepeatedInFile > 0 &&
                                  ` · ${s.scan.skippedRepeatedInFile} repeated`}
                              </p>
                              {/* Most scrapes write numbers the local way, with
                                  no country code, and those can only be read
                                  once the market is known. Saying so beats
                                  leaving someone to conclude the file is bad. */}
                              {s.scan.usable === 0 ? (
                                <p className="mt-0.5 text-[12px] font-semibold text-destructive">
                                  Nothing usable yet
                                  {s.region === "none"
                                    ? " — pick the folder for this list's country and these will be read in its format."
                                    : ` — none of these look like ${REGION_LABELS[s.region as CallRegion]} numbers.`}
                                </p>
                              ) : (
                                s.region === "none" &&
                                s.scan.skippedBadNumber.length > 0 && (
                                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                                    Set a folder to read those in that
                                    country&rsquo;s format.
                                  </p>
                                )
                              )}

                              {/* The overlap, named. Everything the CRM already
                                  holds, wherever it sits — last month's scrape
                                  of this niche is the usual answer, and the
                                  list names are how you tell. */}
                              {s.scan.duplicatesInCrm > 0 && (
                                <div className="mt-2 rounded-md bg-muted/60 px-2.5 py-2">
                                  <p className="text-[12px] text-muted-foreground">
                                    <span className="font-semibold text-foreground">
                                      {s.scan.duplicatesInCrm}
                                    </span>{" "}
                                    already in the CRM
                                    {s.scan.duplicateLists.length > 0 && (
                                      <>
                                        {" "}
                                        — on{" "}
                                        {s.scan.duplicateLists
                                          .map((d) => `${d.name} (${d.count})`)
                                          .join(", ")}
                                        {s.scan.otherListCount > 0 &&
                                          ` and ${s.scan.otherListCount} other ${
                                            s.scan.otherListCount === 1
                                              ? "list"
                                              : "lists"
                                          }`}
                                      </>
                                    )}
                                  </p>
                                  <label className="mt-1.5 flex items-center gap-2 text-[13px]">
                                    <input
                                      type="checkbox"
                                      className="size-3.5 accent-primary"
                                      checked={s.dropDuplicates}
                                      onChange={(e) =>
                                        update(s.key, {
                                          dropDuplicates: e.target.checked,
                                        })
                                      }
                                    />
                                    Remove them —{" "}
                                    <span className="font-semibold">
                                      {toImport(s)}
                                    </span>{" "}
                                    to import
                                  </label>
                                  {!s.dropDuplicates ? (
                                    <p className="mt-1 text-[12px] text-muted-foreground">
                                      Kept, but flagged as duplicates: they
                                      never reach anybody&rsquo;s queue.
                                    </p>
                                  ) : (
                                    toImport(s) === 0 && (
                                      <p className="mt-1 text-[12px] font-semibold text-destructive">
                                        That is the whole file — you already
                                        have every number in it.
                                      </p>
                                    )
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" />
                              Reading…
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${s.file.name}`}
                          onClick={() =>
                            setStaged((prev) =>
                              prev.filter((x) => x.key !== s.key),
                            )
                          }
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      </div>

                      {!s.error && !appending && (
                        <div className="mt-3 space-y-2">
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                            <Input
                              value={s.name}
                              onChange={(e) =>
                                update(s.key, { name: e.target.value })
                              }
                              placeholder="List name"
                              aria-label={`Name for ${s.file.name}`}
                              required
                            />
                            <Select
                              value={s.region}
                              onValueChange={(v) => {
                                const next = v as CallRegion | "none";
                                update(s.key, { region: next });
                                // The count is only true for one market, so it
                                // is re-read rather than left saying what the
                                // previous folder found.
                                void scanFile(s.key, s.file, next);
                              }}
                            >
                              <SelectTrigger
                                className="w-full sm:w-40"
                                aria-label={`Folder for ${s.file.name}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REGION_ORDER.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {REGION_LABELS[r]}
                                  </SelectItem>
                                ))}
                                <SelectItem value="none">Unfiled</SelectItem>
                              </SelectContent>
                            </Select>
                            {/* A split names an owner per part, so the file's
                                own owner select would be a second answer to
                                the same question. */}
                            {canAssign && s.split === 1 && (
                              <Select
                                value={s.ownerId}
                                onValueChange={(v) =>
                                  update(s.key, { ownerId: v })
                                }
                              >
                                <SelectTrigger
                                  className="w-full sm:w-40"
                                  aria-label={`Owner for ${s.file.name}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_OWNER}>
                                    Nobody yet
                                  </SelectItem>
                                  {people.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                      {p.name}
                                      {!p.active && " (off)"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          {/* One niche, several callers. The parts are dealt
                              round robin rather than cut into blocks, so each
                              gets the same mix of a file that arrived sorted
                              by city or rating. */}
                          <div className="flex flex-wrap items-center gap-2 text-[13px]">
                            <Label
                              htmlFor={`split-${domId}`}
                              className="text-muted-foreground"
                            >
                              Split into
                            </Label>
                            <Select
                              value={String(s.split)}
                              onValueChange={(v) => {
                                const next = Number(v);
                                update(s.key, {
                                  split: next,
                                  // Keep whoever was already picked; the first
                                  // part inherits the file's owner so widening
                                  // a split does not silently unassign it.
                                  partOwnerIds: Array.from(
                                    { length: next },
                                    (_, i) =>
                                      s.partOwnerIds[i] ??
                                      (i === 0 ? s.ownerId : NO_OWNER),
                                  ),
                                });
                              }}
                            >
                              <SelectTrigger
                                id={`split-${domId}`}
                                className="w-24"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from(
                                  { length: MAX_SPLIT },
                                  (_, i) => i + 1,
                                ).map((n) => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n === 1 ? "1 list" : `${n} lists`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {s.split > 1 && (
                              <span className="text-muted-foreground">
                                dealt out evenly, not cut into blocks
                              </span>
                            )}
                          </div>

                          {s.split > 1 && (
                            <ul className="space-y-1.5 rounded-md border border-dashed p-2.5">
                              {partSizes(toImport(s), s.split).map(
                                (size, i) => (
                                  <li
                                    key={i}
                                    className="flex flex-wrap items-center gap-2 text-[13px]"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {s.name.trim() || s.file.name} {i + 1}
                                      <span className="text-muted-foreground">
                                        {" "}
                                        · {size} leads
                                      </span>
                                    </span>
                                    {canAssign && (
                                      <Select
                                        value={s.partOwnerIds[i] ?? NO_OWNER}
                                        onValueChange={(v) => {
                                          const next = [...s.partOwnerIds];
                                          next[i] = v;
                                          update(s.key, { partOwnerIds: next });
                                        }}
                                      >
                                        <SelectTrigger
                                          className="w-full sm:w-40"
                                          aria-label={`Owner for part ${i + 1} of ${s.file.name}`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value={NO_OWNER}>
                                            Nobody yet
                                          </SelectItem>
                                          {people.map((p) => (
                                            <SelectItem
                                              key={p.id}
                                              value={String(p.id)}
                                            >
                                              {p.name}
                                              {!p.active && " (off)"}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </li>
                                ),
                              )}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}

              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>

            <DialogFooter className="items-center gap-2 sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                {!scanning &&
                  (importable.length > 0
                    ? `${totalUsable} leads into ${totalLists} ${
                        totalLists === 1 ? "list" : "lists"
                      }${empty.length > 0 ? `, ${empty.length} file${empty.length === 1 ? "" : "s"} with nothing to import` : ""}`
                    : empty.length > 0
                      ? "Nothing to import from these files."
                      : "")}
              </p>
              <Button type="submit" disabled={!ready || submitting}>
                {submitting
                  ? "Importing…"
                  : appending
                    ? "Add to list"
                    : `Import${
                        importable.length > 1 ? ` ${importable.length} lists` : ""
                      }`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
