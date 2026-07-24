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

type ImportResult = {
  imported: number;
  duplicates: number;
  skippedNoEmail: number;
  neverbounceColumn: string | null;
};

function nameFromFilename(filename: string) {
  return filename
    .replace(/\.csv$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function ImportDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [niche, setNiche] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  function reset() {
    setFile(null);
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
      body.append("name", name);
      body.append("niche", niche);
      const res = await fetch("/api/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Import failed (${res.status}).`);
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError("Import failed — network error.");
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
                Lead list &ldquo;{name}&rdquo; created.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 text-[13px]">
              <p>
                <span className="font-medium">{result.imported}</span> contacts
                imported
              </p>
              <p>
                <span className="font-medium">{result.duplicates}</span> flagged
                as duplicates of existing contacts
              </p>
              {result.skippedNoEmail > 0 && (
                <p className="text-muted-foreground">
                  {result.skippedNoEmail} rows skipped (no email address)
                </p>
              )}
              {!result.neverbounceColumn && (
                <p className="text-warning">
                  No NeverBounce column detected — all rows marked
                  &ldquo;unknown&rdquo;.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Import CSV</DialogTitle>
              <DialogDescription>
                Apollo export with a NeverBounce result column. Each import
                creates a new lead list.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="import-file">CSV file</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-name">Lead list name</Label>
                <Input
                  id="import-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameEdited(true);
                  }}
                  placeholder="e.g. steel fabricators SG, Jul 2026"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-niche">Niche (optional)</Label>
                <Input
                  id="import-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. steel fabricators"
                />
              </div>
              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!file || name.trim() === "" || submitting}>
                {submitting ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
