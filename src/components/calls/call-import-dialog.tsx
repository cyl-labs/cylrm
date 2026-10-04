"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { FileDrop } from "@/components/file-drop";
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
import { partName } from "@/lib/list-name";
import type { SameBusinessRow } from "@/lib/same-business";
import { cn } from "@/lib/utils";
import { SameBusinessList, TickAll } from "@/components/calls/same-business-rows";

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

const READ_TIMEOUT_MS = 90_000;

/**
 * The file as it should travel: gzipped when the browser can, since a scrape is
 * mostly empty columns and shrinks to about a fifth (a 3.3 MB file became 0.66).
 * On a slow upload that is the whole difference, and the file goes twice, once
 * to be checked and once to be imported, so the packed copy is kept. Falls back
 * to the original anywhere that cannot compress, and when packing does not help.
 */
const packed = new WeakMap<File, Promise<File>>();
function packForUpload(file: File): Promise<File> {
  let p = packed.get(file);
  if (!p) {
    p = (async () => {
      if (typeof CompressionStream === "undefined") return file;
      try {
        const blob = await new Response(
          file.stream().pipeThrough(new CompressionStream("gzip")),
        ).blob();
        return blob.size < file.size
          ? new File([blob], `${file.name}.gz`, { type: "application/gzip" })
          : file;
      } catch {
        return file;
      }
    })();
    packed.set(file, p);
  }
  return p;
}

/**
 * The wait while a file is read: a bar that fills as the file reaches the
 * server, which is a measured figure, then a moving bar while the server
 * checks it, because how far that check has got is not something it reports.
 */
function ReadingNote({ size, uploaded }: { size: number; uploaded: number }) {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mb = Math.max(0.1, size / 1_000_000).toFixed(1);
  const sent = uploaded >= 1;
  return (
    <div className="mt-0.5 text-[13px] text-muted-foreground">
      <p className="flex items-center justify-between gap-2">
        <span>
          {sent
            ? "Step 2 of 2: checking it against every business already in the CRM"
            : `Step 1 of 2: sending the file (${mb} MB, sent compressed)`}
        </span>
        <span className="tabular-nums">
          {sent ? `${seconds}s` : `${Math.round(uploaded * 100)}%`}
        </span>
      </p>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={sent ? "Checking the file" : "Sending the file"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={sent ? undefined : Math.round(uploaded * 100)}
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            sent ? "w-1/3 animate-pulse" : "transition-[width] duration-200",
          )}
          style={sent ? undefined : { width: `${Math.round(uploaded * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[12px]">
        A big file can take up to a minute. Nothing is saved until you press
        Import.
      </p>
    </div>
  );
}

type Scan = {
  usable: number;
  /** Numbers with no "+" in the file: the only ones the folder can change. */
  withoutCountryCode: number;
  /** Usable rows whose number the CRM already holds, anywhere. */
  duplicatesInCrm: number;
  /** Where those copies sit, biggest first — the answer to "already where?". */
  duplicateLists: { name: string; count: number }[];
  otherListCount: number;
  skippedNoPhone: number;
  skippedRepeatedInFile: number;
  skippedBadNumber: { company: string; phone: string }[];
  /** Rows that may be a business already held under another number, or an
   *  earlier row of the file. Suggestions: see `sameBusiness` on Staged. */
  sameBusiness: SameBusinessRow[];
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
  /** Phone keys of the suggested rows a founder ticked as the same business.
   *  Empty to begin with: nothing is treated as a copy until somebody says. */
  sameBusiness: string[];
  scan: Scan | null;
  /** How much of the file has reached the server while it is being read, 0 to 1. */
  uploaded: number;
  /** Why this file cannot be imported, from the server's own parser. */
  error: string | null;
};

type ImportResult = {
  callListName: string;
  appended: boolean;
  inserted: number;
  duplicates: number;
  /** Kept but flagged, as a business ticked on the review. */
  sameBusiness: number;
  removedDuplicates: number;
  removedSameBusiness: number;
  alreadyInList: number;
  skippedNoPhone: number;
  skippedRepeatedInFile: number;
  skippedBadNumber: { company: string; phone: string }[];
};

const NEW_LIST = "__new__";
const NO_OWNER = "__none__";
/** The server's ceiling, restated for the picker. 40 since 2026-09-26: the
 *  founders wanted lists of about 150, and a 1,800-lead scrape at 10 lists
 *  left each at 180. */
const MAX_SPLIT = 40;

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

/**
 * The rows that may be a business the CRM already has, under another number.
 *
 * Folded when there are many, because a big scrape can suggest dozens and the
 * dialog also has to show the name, folder and owner below it. Opened by
 * default when there are only a few, which is the usual case and one glance.
 */
function SameBusinessPanel({
  rows,
  ticked,
  onChange,
}: {
  rows: SameBusinessRow[];
  ticked: string[];
  onChange: (next: string[]) => void;
}) {
  const items = rows.map((r) => ({
    key: r.key,
    lead: {
      id: null,
      company: r.company,
      phone: r.phone,
      where: r.where,
      list: null,
      owner: null,
      lastOutcome: null,
      website: r.website,
    },
    looksLike: r.looksLike,
    more: r.more,
  }));
  return (
    <details
      open={rows.length <= 5}
      className="group mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2"
    >
      <summary className="cursor-pointer list-none text-[12px]">
        <span className="font-semibold text-foreground">
          {rows.length} may be a business you already have
        </span>{" "}
        <span className="text-muted-foreground">
          under a different number
          {ticked.length > 0 && ` · ${ticked.length} ticked`}
          <span className="group-open:hidden"> · show</span>
        </span>
      </summary>
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          Matched on the name or website, so check each one. Tick the ones
          that are the same business. Only those are held back. Anything left
          unticked is imported as a new lead.
        </p>
        <TickAll
          keys={rows.map((r) => r.key)}
          ticked={ticked}
          onChange={onChange}
        />
      </div>
      <SameBusinessList
        items={items}
        ticked={ticked}
        onChange={onChange}
        offLabel="Keep as new"
        className="mt-1 max-h-72 overflow-y-auto"
      />
    </details>
  );
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
      // The ticks go with the old reading: a different folder can read the
      // numbers differently, and the keys they were given by with them.
      setStaged((prev) =>
        prev.map((s) =>
          s.key === key
            ? { ...s, scan: null, error: null, sameBusiness: [], uploaded: 0 }
            : s,
        ),
      );
      const body = new FormData();
      body.append("file", await packForUpload(file));
      body.append("dryRun", "1");
      if (region !== "none") body.append("region", region);
      // XMLHttpRequest rather than fetch, because it is the one that reports
      // how many bytes of the file have actually left the browser. That makes
      // the first half of the wait a real percentage, and when a reading hangs
      // it shows whether the file never arrived or the checking never ended.
      //
      // A reading that never comes back used to spin for ever with nothing to
      // press. The server takes a few seconds on a big scrape, so a minute and
      // a half means something is wrong and the person should be told.
      const setUploaded = (uploaded: number) =>
        setStaged((prev) =>
          prev.map((s) => (s.key === key ? { ...s, uploaded } : s)),
        );
      try {
        const { ok, data } = await new Promise<{
          ok: boolean;
          data: { error?: string };
        }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/call-lists");
          xhr.timeout = READ_TIMEOUT_MS;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) setUploaded(e.loaded / e.total);
          };
          xhr.upload.onload = () => setUploaded(1);
          xhr.onload = () => {
            let parsed: { error?: string } = {};
            try {
              parsed = JSON.parse(xhr.responseText);
            } catch {
              // Not JSON: left empty, the caller says "Could not read it".
            }
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, data: parsed });
          };
          xhr.onerror = () => reject(new Error("network"));
          xhr.ontimeout = () => reject(new Error("timeout"));
          xhr.send(body);
        });
        setStaged((prev) =>
          prev.map((s) =>
            s.key === key
              ? ok
                ? { ...s, scan: data as unknown as Scan, error: null }
                : { ...s, scan: null, error: data.error ?? "Could not read it." }
              : s,
          ),
        );
      } catch (err) {
        const timedOut = err instanceof Error && err.message === "timeout";
        setStaged((prev) =>
          prev.map((s) =>
            s.key === key
              ? {
                  ...s,
                  scan: null,
                  error: timedOut
                    ? s.uploaded < 1
                      ? `The file only got ${Math.round(s.uploaded * 100)}% of the way to the server before we stopped waiting. Check your connection, then remove the file and add it again.`
                      : "The file arrived, but the server did not finish checking it, so we stopped waiting. Remove the file and add it again. If it keeps happening, tell a founder."
                    : "Could not read it.",
                }
              : s,
          ),
        );
      }
    },
    [],
  );

  async function addFiles(picked: File[]) {
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
        sameBusiness: [],
        scan: null,
        uploaded: 0,
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
  // has when they are being dropped — by number, or as a business somebody
  // ticked. This is the number the split is dealt from, so it is the one the
  // screen counts with.
  const toImport = (s: Staged) =>
    s.scan === null
      ? 0
      : s.scan.usable -
        (s.dropDuplicates
          ? s.scan.duplicatesInCrm + s.sameBusiness.length
          : 0);

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
        body.append("file", await packForUpload(s.file));
        if (s.dropDuplicates) body.append("dropDuplicates", "1");
        for (const key of s.sameBusiness) body.append("sameBusiness", key);
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
              (done.length ? ` (${done.length} imported before this.)` : ""),
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
                    {r.removedSameBusiness > 0 &&
                      ` · ${r.removedSameBusiness} removed as a business you already have`}
                    {r.duplicates > 0 &&
                      ` · ${r.duplicates} already on another list, held out of the queue`}
                    {r.sameBusiness > 0 &&
                      ` · ${r.sameBusiness} kept as a business you already have, held out of the queue`}
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
                CSVs with a phone column. Pick as many as you like. Each
                becomes its own list, and nothing is created until you press
                Import.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <FileDrop
                id="call-import-file"
                multiple
                onFiles={addFiles}
                label={staged.length > 0 ? "Add more files" : "Choose CSV files"}
              />

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
                                    ? ". Pick the folder for this list's country and these will be read in its format."
                                    : `. None of these look like ${REGION_LABELS[s.region as CallRegion]} numbers.`}
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
                              {s.scan.sameBusiness.length > 0 && (
                                <SameBusinessPanel
                                  rows={s.scan.sameBusiness}
                                  ticked={s.sameBusiness}
                                  onChange={(next) =>
                                    update(s.key, { sameBusiness: next })
                                  }
                                />
                              )}

                              {(s.scan.duplicatesInCrm > 0 ||
                                s.sameBusiness.length > 0) && (
                                <div className="mt-2 rounded-md bg-muted/60 px-2.5 py-2">
                                  {s.scan.duplicatesInCrm > 0 && (
                                    <p className="text-[12px] text-muted-foreground">
                                      <span className="font-semibold text-foreground">
                                        {s.scan.duplicatesInCrm}
                                      </span>{" "}
                                      {s.scan.duplicatesInCrm === 1
                                        ? "number is"
                                        : "numbers are"}{" "}
                                      already in the CRM
                                      {s.scan.duplicateLists.length > 0 && (
                                        <>
                                          , on{" "}
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
                                  )}
                                  {s.sameBusiness.length > 0 && (
                                    <p className="text-[12px] text-muted-foreground">
                                      <span className="font-semibold text-foreground">
                                        {s.sameBusiness.length}
                                      </span>{" "}
                                      ticked as a business you already have
                                    </p>
                                  )}
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
                                    Remove them:{" "}
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
                                        That is the whole file. You already
                                        have every row in it.
                                      </p>
                                    )
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <ReadingNote size={s.file.size} uploaded={s.uploaded} />
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
                                // previous folder found. Unless every number
                                // already carries its country code: then no
                                // folder reads it differently, and reading a
                                // big file again is a wait for the same answer.
                                if (s.scan?.withoutCountryCode !== 0) {
                                  void scanFile(s.key, s.file, next);
                                }
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
                                className="w-auto min-w-24"
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
                                    {/* The size, since that is what people
                                        pick by: "about 150 each". */}
                                    <span className="text-muted-foreground">
                                      {" "}
                                      &middot; {Math.ceil(toImport(s) / n)} each
                                    </span>
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
                                      {/* Through `partName`, not a template of
                                          its own: this row's whole job is to
                                          show what the importer will create. */}
                                      {partName(
                                        s.name.trim() || s.file.name,
                                        i,
                                      )}
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
