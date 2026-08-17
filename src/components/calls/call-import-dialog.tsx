"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
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

type ImportResult = {
  callListId: number;
  callListName: string;
  appended: boolean;
  inserted: number;
  duplicates: number;
  alreadyInList: number;
  skippedNoPhone: number;
  skippedRepeatedInFile: number;
  skippedBadNumber: { company: string; phone: string }[];
};

const NEW_LIST = "__new__";

function nameFromFilename(filename: string) {
  return filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
}

export function CallImportDialog({
  callLists,
}: {
  callLists: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [target, setTarget] = React.useState<string>(NEW_LIST);
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [niche, setNiche] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  const creatingList = target === NEW_LIST;

  function reset() {
    setFile(null);
    setTarget(NEW_LIST);
    setName("");
    setNameEdited(false);
    setNiche("");
    setSubmitting(false);
    setError(null);
    setResult(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
    if (selected && !nameEdited) setName(nameFromFilename(selected.name));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (creatingList) {
        body.append("name", name);
        body.append("niche", niche);
      } else {
        body.append("callListId", target);
      }
      const res = await fetch("/api/call-lists", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Import failed (${res.status}).`);
        return;
      }
      setResult(data as ImportResult);
      router.refresh();
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload data-icon="inline-start" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Import complete</DialogTitle>
              <DialogDescription>
                {result.appended
                  ? `Added to “${result.callListName}”.`
                  : `Call list “${result.callListName}” created.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 text-[13px]">
              <p>
                <span className="font-medium">{result.inserted}</span> leads
                imported
              </p>
              {result.duplicates > 0 && (
                <p className="text-muted-foreground">
                  {result.duplicates} flagged: that number is already on
                  another list, so they stay out of the queue
                </p>
              )}
              {result.alreadyInList > 0 && (
                <p className="text-muted-foreground">
                  {result.alreadyInList} already in this list, skipped
                </p>
              )}
              {result.skippedRepeatedInFile > 0 && (
                <p className="text-muted-foreground">
                  {result.skippedRepeatedInFile} repeated in the file, skipped
                </p>
              )}
              {result.skippedNoPhone > 0 && (
                <p className="text-muted-foreground">
                  {result.skippedNoPhone}{" "}
                  {result.skippedNoPhone === 1 ? "row had" : "rows had"} no
                  phone number
                </p>
              )}
              {result.skippedBadNumber.length > 0 && (
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="font-medium">
                    {result.skippedBadNumber.length} skipped: not a Singapore
                    number:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {result.skippedBadNumber.slice(0, 6).map((b) => (
                      <li key={`${b.company}-${b.phone}`} className="truncate">
                        {b.company}: {b.phone}
                      </li>
                    ))}
                    {result.skippedBadNumber.length > 6 && (
                      <li>…and {result.skippedBadNumber.length - 6} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Import call list</DialogTitle>
              <DialogDescription>
                A CSV with a phone column. Everything else (name, company,
                title, email) is optional.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="call-import-file">CSV file</Label>
                <Input
                  id="call-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                />
              </div>
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
              {creatingList && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="call-import-name">Call list name</Label>
                    <Input
                      id="call-import-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameEdited(true);
                      }}
                      placeholder="e.g. aircon servicing SG, Aug 2026"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="call-import-niche">Niche (optional)</Label>
                    <Input
                      id="call-import-niche"
                      value={niche}
                      onChange={(e) => setNiche(e.target.value)}
                      placeholder="e.g. aircon servicing"
                    />
                  </div>
                </>
              )}
              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!file || (creatingList && name.trim() === "") || submitting}
              >
                {submitting ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
