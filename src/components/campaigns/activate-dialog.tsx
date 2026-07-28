"use client";

import * as React from "react";
import { AlertTriangle, Check, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CampaignPreflight,
  CheckLevel,
  PreflightVersion,
} from "@/lib/campaign-preflight";

const ICON: Record<CheckLevel, React.ElementType> = {
  blocker: XCircle,
  warning: AlertTriangle,
  ok: Check,
};

const ICON_CLASS: Record<CheckLevel, string> = {
  blocker: "text-destructive",
  warning: "text-warning",
  ok: "text-success",
};

function CheckRow({ level, title, detail }: { level: CheckLevel; title: string; detail: string }) {
  const Icon = ICON[level];
  return (
    <li className="flex gap-2.5">
      <Icon className={`mt-0.5 size-4 shrink-0 ${ICON_CLASS[level]}`} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        {detail && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}

function Version({
  v,
  name,
}: {
  v: PreflightVersion;
  name: string | null;
}) {
  return (
    <div>
      {name && (
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {name}
          {v.label && <span className="text-foreground"> · {v.label}</span>}
        </p>
      )}
      {v.subject !== null && (
        <p className="text-[13px]">
          <span className="text-muted-foreground">Subject: </span>
          {v.subject || <span className="text-destructive">(empty)</span>}
        </p>
      )}
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">
        {v.body || "(empty)"}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-[13px] font-medium">{value}</p>
    </div>
  );
}

export function ActivateDialog({
  open,
  onOpenChange,
  campaignId,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  onConfirm: () => void;
  confirming: boolean;
}) {
  // Mounted only while open, so each opening re-runs the checks from scratch
  // rather than showing whatever the last look found.
  if (!open) return null;
  return (
    <PreflightDialog
      campaignId={campaignId}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      confirming={confirming}
    />
  );
}

function PreflightDialog({
  campaignId,
  onOpenChange,
  onConfirm,
  confirming,
}: {
  campaignId: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const [data, setData] = React.useState<CampaignPreflight | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/preflight`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? "Could not load the preview.");
        else setData(body);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the preview — network error.");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const blockers = data?.checks.filter((c) => c.level === "blocker") ?? [];
  const warnings = data?.checks.filter((c) => c.level === "warning") ?? [];
  const oks = data?.checks.filter((c) => c.level === "ok") ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start sending?</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.campaignName} — what happens once this campaign goes active.`
              : "Checking the campaign…"}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="py-4 text-[13px] text-destructive">{error}</p>}
        {!data && !error && (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            Running preflight checks…
          </p>
        )}

        {data && (
          <div className="space-y-5 py-4">
            <div className="grid grid-cols-2 gap-4 rounded-lg border p-3 sm:grid-cols-4">
              <Stat
                label="Contacts"
                value={data.activeEnrollments.toLocaleString()}
              />
              <Stat label="Emails to send" value={data.toSend.toLocaleString()} />
              <Stat
                label="Per day"
                value={`${data.progress.capacityPerDay.toLocaleString()} max`}
              />
              <Stat
                label="Finishes"
                value={
                  data.progress.etaDate
                    ? new Date(data.progress.etaDate).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", year: "numeric" },
                      )
                    : "—"
                }
              />
            </div>

            {data.variantSplit && (
              <p className="text-[13px] text-muted-foreground">
                A/B test running:{" "}
                <span className="font-medium text-foreground">
                  {data.variantSplit.a.toLocaleString()}
                </span>{" "}
                contacts on version A,{" "}
                <span className="font-medium text-foreground">
                  {data.variantSplit.b.toLocaleString()}
                </span>{" "}
                on version B.
              </p>
            )}

            {blockers.length > 0 && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-destructive">
                  Must fix before starting
                </h3>
                <ul className="space-y-2.5">
                  {blockers.map((c, i) => (
                    <CheckRow key={i} {...c} />
                  ))}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Worth checking</h3>
                <ul className="space-y-2.5">
                  {warnings.map((c, i) => (
                    <CheckRow key={i} {...c} />
                  ))}
                </ul>
              </div>
            )}

            {oks.length > 0 && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Ready</h3>
                <ul className="space-y-2.5">
                  {oks.map((c, i) => (
                    <CheckRow key={i} {...c} />
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-[13px] font-semibold">
                What goes out
                {data.sampleContactEmail && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — previewed for {data.sampleContactEmail}
                  </span>
                )}
              </h3>
              <div className="space-y-2">
                {data.steps.map((s) => (
                  <div key={s.stepNumber} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">
                        Step {s.stepNumber}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {s.stepNumber === 1
                          ? "sends immediately"
                          : `${s.waitDaysAfterPrevious} day${s.waitDaysAfterPrevious === 1 ? "" : "s"} after the previous`}
                      </span>
                      {s.b && (
                        <Badge variant="secondary" className="text-[11px]">
                          A/B
                        </Badge>
                      )}
                    </div>
                    {s.b ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Version v={s.a} name="Version A" />
                        <div className="md:border-l md:pl-4">
                          <Version v={s.b} name="Version B" />
                        </div>
                      </div>
                    ) : (
                      <Version v={s.a} name={null} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!data || !data.canActivate || confirming}
            title={
              data && !data.canActivate
                ? "Fix the blockers above first"
                : undefined
            }
          >
            <Play data-icon="inline-start" />
            {confirming ? "Starting…" : "Start sending"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
