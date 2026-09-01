"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { FileDrop } from "@/components/file-drop";
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
  leadListId: number;
  leadListName: string;
  appended: boolean;
  imported: number;
  newContactIds: number[];
  duplicates: number;
  skippedNoEmail: number;
  /** Filled in client-side after the follow-up enroll call, if one was asked for. */
  enrollSummary?: string;
  enrollError?: string;
};

const NEW_LIST = "__new__";
const NO_CAMPAIGN = "__none__";

function nameFromFilename(filename: string) {
  return filename
    .replace(/\.csv$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function ImportDialog({
  leadLists,
  campaigns,
}: {
  leadLists: { id: number; name: string }[];
  campaigns: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [target, setTarget] = React.useState<string>(NEW_LIST);
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [niche, setNiche] = React.useState("");
  const [campaignId, setCampaignId] = React.useState<string>(NO_CAMPAIGN);
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
    setCampaignId(NO_CAMPAIGN);
    setSubmitting(false);
    setError(null);
    setResult(null);
  }

  function handleFiles(picked: File[]) {
    const selected = picked[0] ?? null;
    if (!selected) return;
    setFile(selected);
    setError(null);
    if (!nameEdited) setName(nameFromFilename(selected.name));
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
        body.append("leadListId", target);
      }
      const res = await fetch("/api/import", { method: "POST", body });
      const data: ImportResult = await res.json();
      if (!res.ok) {
        setError(
          (data as unknown as { error?: string }).error ??
            `Import failed (${res.status}).`,
        );
        return;
      }

      // Enroll only the contacts this file actually added. Sweeping the whole
      // lead list would drag in earlier batches, and any of those that had
      // already finished the sequence would start it over.
      if (campaignId !== NO_CAMPAIGN && data.newContactIds.length > 0) {
        try {
          const enrollRes = await fetch("/api/enroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaignId: Number(campaignId),
              contactIds: data.newContactIds,
            }),
          });
          const enrollData = await enrollRes.json();
          if (!enrollRes.ok) {
            data.enrollError =
              enrollData.error ?? `Enroll failed (${enrollRes.status}).`;
          } else {
            const campaignName =
              campaigns.find((c) => String(c.id) === campaignId)?.name ?? "";
            data.enrollSummary = `${enrollData.enrolled} enrolled in ${campaignName} (${enrollData.variantSplit.a} version A / ${enrollData.variantSplit.b} version B)`;
          }
        } catch {
          data.enrollError = "Imported, but the enroll request failed.";
        }
      }

      setResult(data);
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
                  ? `Added to “${result.leadListName}”.`
                  : `Lead list “${result.leadListName}” created.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 text-[13px]">
              <p>
                <span className="font-medium">
                  {result.newContactIds.length}
                </span>{" "}
                new contacts imported
              </p>
              {result.duplicates > 0 && (
                <p className="text-muted-foreground">
                  {result.duplicates} flagged as duplicates of existing contacts
                </p>
              )}
              {result.skippedNoEmail > 0 && (
                <p className="text-muted-foreground">
                  {result.skippedNoEmail} rows skipped (no email address)
                </p>
              )}
              {result.enrollSummary && <p>{result.enrollSummary}</p>}
              {result.enrollError && (
                <p className="text-destructive">{result.enrollError}</p>
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
                Apollo CSV export. Add it to an existing lead list to top that
                niche up, or start a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <FileDrop
                  id="import-file"
                  onFiles={handleFiles}
                  // The zone is the only thing on screen, so it has to say
                  // which file was picked — the native control did that.
                  label={file ? file.name : "Choose a CSV file"}
                  hint={file ? "Pick another to replace it" : undefined}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-target">Lead list</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="import-target" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_LIST}>Create a new list</SelectItem>
                    {leadLists.map((l) => (
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
                </>
              )}
              {campaigns.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="import-campaign">
                    Enroll in campaign (optional)
                  </Label>
                  <Select value={campaignId} onValueChange={setCampaignId}>
                    <SelectTrigger id="import-campaign" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CAMPAIGN}>
                        Don&rsquo;t enroll yet
                      </SelectItem>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Only the contacts this file adds are enrolled: anyone
                    already in the list is left alone.
                  </p>
                </div>
              )}
              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  !file ||
                  (creatingList && name.trim() === "") ||
                  submitting
                }
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
