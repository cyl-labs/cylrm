"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type StepData = {
  id: number;
  stepNumber: number;
  waitDaysAfterPrevious: number;
  subjectTemplate: string | null;
  bodyTemplate: string;
};

function StepCard({ step, isLast }: { step: StepData; isLast: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState(step.subjectTemplate ?? "");
  const [bodyText, setBodyText] = React.useState(step.bodyTemplate);
  const [waitDays, setWaitDays] = React.useState(String(step.waitDaysAfterPrevious));
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const dirty =
    subject !== (step.subjectTemplate ?? "") ||
    bodyText !== step.bodyTemplate ||
    Number(waitDays) !== step.waitDaysAfterPrevious;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectTemplate: step.stepNumber === 1 ? subject : undefined,
          bodyTemplate: bodyText,
          waitDaysAfterPrevious: Number(waitDays),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save step.");
        return;
      }
      toast.success(`Step ${step.stepNumber} saved.`);
      router.refresh();
    } catch {
      toast.error("Failed to save step — network error.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/steps/${step.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete step.");
        return;
      }
      toast.success(`Step ${step.stepNumber} deleted.`);
      router.refresh();
    } catch {
      toast.error("Failed to delete step — network error.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm">Step {step.stepNumber}</CardTitle>
          {step.stepNumber > 1 && (
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              after
              <Input
                type="number"
                min={0}
                step={1}
                value={waitDays}
                onChange={(e) => setWaitDays(e.target.value)}
                className="h-7 w-16 text-[13px]"
                aria-label={`Wait days before step ${step.stepNumber}`}
              />
              day(s)
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {step.stepNumber > 1 && isLast && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={remove}
                disabled={deleting}
                title="Delete step"
              >
                <Trash2 />
                <span className="sr-only">Delete step {step.stepNumber}</span>
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
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
            Sends as a reply in the same thread (&ldquo;Re: step 1
            subject&rdquo;).
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
      </CardContent>
    </Card>
  );
}

export function StepsEditor({
  campaignId,
  steps,
}: {
  campaignId: number;
  steps: StepData[];
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
      toast.error("Failed to add step — network error.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Merge fields: {"{{first_name}} {{last_name}} {{company}} {{title}} {{email}}"}
      </p>
      {steps.map((s) => (
        <StepCard key={s.id} step={s} isLast={s.stepNumber === steps.length} />
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
