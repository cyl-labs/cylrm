"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type StepData = {
  id: number;
  stepNumber: number;
  variant: "a" | "b";
  label: string | null;
  waitDaysAfterPrevious: number;
  subjectTemplate: string | null;
  bodyTemplate: string;
};

/** One step, with the optional B version of its copy alongside the A version. */
export type StepGroup = {
  stepNumber: number;
  a: StepData;
  b: StepData | null;
};

/** Subject + body for one arm. Each arm saves independently. */
function VariantFields({
  step,
  armName,
  hasSibling,
}: {
  step: StepData;
  armName: string;
  hasSibling: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = React.useState(step.subjectTemplate ?? "");
  const [bodyText, setBodyText] = React.useState(step.bodyTemplate);
  const [label, setLabel] = React.useState(step.label ?? "");
  const [saving, setSaving] = React.useState(false);

  const dirty =
    subject !== (step.subjectTemplate ?? "") ||
    bodyText !== step.bodyTemplate ||
    label !== (step.label ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectTemplate: step.stepNumber === 1 ? subject : undefined,
          bodyTemplate: bodyText,
          label,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save step.");
        return;
      }
      toast.success(
        hasSibling
          ? `Step ${step.stepNumber} ${armName} saved.`
          : `Step ${step.stepNumber} saved.`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to save step: network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {hasSibling && (
        <div className="space-y-1.5">
          <Label htmlFor={`step-${step.id}-label`}>
            What this version is trying
          </Label>
          <Input
            id={`step-${step.id}-label`}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. shorter opener, no question"
          />
        </div>
      )}
      {step.stepNumber === 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor={`step-${step.id}-subject`}>Subject</Label>
          <Input
            id={`step-${step.id}-subject`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Quick question, {{first_name}}"
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Sends as a reply in the same thread (&ldquo;Re: step 1 subject&rdquo;).
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`step-${step.id}-body`}>Body</Label>
        <Textarea
          id={`step-${step.id}-body`}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={7}
          placeholder="Hi {{first_name}}, …"
        />
      </div>
      <Button size="sm" onClick={save} disabled={!dirty || saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function StepCard({
  group,
  isLast,
  hasEnrollments,
}: {
  group: StepGroup;
  isLast: boolean;
  hasEnrollments: boolean;
}) {
  const router = useRouter();
  const { a, b, stepNumber } = group;
  const [waitDays, setWaitDays] = React.useState(String(a.waitDaysAfterPrevious));
  const [savingWait, setSavingWait] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const waitDirty = Number(waitDays) !== a.waitDaysAfterPrevious;

  async function saveWaitDays() {
    setSavingWait(true);
    try {
      const res = await fetch(`/api/steps/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitDaysAfterPrevious: Number(waitDays) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save wait days.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Failed to save wait days: network error.");
    } finally {
      setSavingWait(false);
    }
  }

  async function addVariant() {
    if (
      hasEnrollments &&
      !window.confirm(
        "This campaign already has contacts enrolled. Half of them are on arm B and " +
          "will switch to this new copy from their next email onwards: emails they " +
          "have already received stay as they were, so the comparison will be muddied. " +
          "Add it anyway?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/steps/${a.id}/variant`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to add B version.");
        return;
      }
      toast.success(`Step ${stepNumber} B version added: edit the wording.`);
      router.refresh();
    } catch {
      toast.error("Failed to add B version: network error.");
    } finally {
      setBusy(false);
    }
  }

  async function removeVariant() {
    if (!b) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/steps/${b.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to remove B version.");
        return;
      }
      toast.success(`Step ${stepNumber} B version removed: everyone gets A.`);
      router.refresh();
    } catch {
      toast.error("Failed to remove B version: network error.");
    } finally {
      setBusy(false);
    }
  }

  async function removeStep() {
    setBusy(true);
    try {
      const res = await fetch(`/api/steps/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete step.");
        return;
      }
      toast.success(`Step ${stepNumber} deleted.`);
      router.refresh();
    } catch {
      toast.error("Failed to delete step: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-sm">Step {stepNumber}</CardTitle>
          {b && (
            <Badge variant="secondary" className="text-[11px]">
              A/B test
            </Badge>
          )}
          {stepNumber > 1 && (
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              after
              <Input
                type="number"
                min={0}
                step={1}
                value={waitDays}
                onChange={(e) => setWaitDays(e.target.value)}
                onBlur={() => waitDirty && saveWaitDays()}
                disabled={savingWait}
                className="h-7 w-16 text-[13px]"
                aria-label={`Wait days before step ${stepNumber}`}
              />
              day(s)
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {b ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={removeVariant}
                disabled={busy}
              >
                <X data-icon="inline-start" />
                Remove B version
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={addVariant}
                disabled={busy}
              >
                <FlaskConical data-icon="inline-start" />
                Add B version
              </Button>
            )}
            {stepNumber > 1 && isLast && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={removeStep}
                disabled={busy}
                title="Delete step"
              >
                <Trash2 />
                <span className="sr-only">Delete step {stepNumber}</span>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        {b ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Version A
              </p>
              <VariantFields step={a} armName="version A" hasSibling />
            </div>
            <div className="space-y-3 md:border-l md:pl-5">
              <p className="text-xs font-medium text-muted-foreground">
                Version B
              </p>
              <VariantFields step={b} armName="version B" hasSibling />
            </div>
          </div>
        ) : (
          <VariantFields step={a} armName="version A" hasSibling={false} />
        )}
      </CardContent>
    </Card>
  );
}

export function StepsEditor({
  campaignId,
  groups,
  hasEnrollments,
}: {
  campaignId: number;
  groups: StepGroup[];
  hasEnrollments: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);

  async function addStep() {
    setAdding(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to add step.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Failed to add step: network error.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Merge fields: {"{{first_name}} {{last_name}} {{company}} {{title}} {{email}}"}
      </p>
      {groups.map((g) => (
        <StepCard
          key={g.a.id}
          group={g}
          isLast={g.stepNumber === groups.length}
          hasEnrollments={hasEnrollments}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addStep}
        disabled={adding}
      >
        <Plus data-icon="inline-start" />
        Add step
      </Button>
    </div>
  );
}
