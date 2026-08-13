import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sequenceStep } from "@/db/schema";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const stepId = Number(id);
  if (!Number.isInteger(stepId)) {
    return Response.json({ error: "Invalid step id." }, { status: 400 });
  }

  let body: {
    subjectTemplate?: unknown;
    bodyTemplate?: unknown;
    waitDaysAfterPrevious?: unknown;
    label?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Partial<{
    subjectTemplate: string | null;
    bodyTemplate: string;
    waitDaysAfterPrevious: number;
    label: string | null;
  }> = {};
  if (body.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length > 60) {
      return Response.json(
        { error: "Keep the label to 60 characters or fewer." },
        { status: 400 },
      );
    }
    updates.label = label === "" ? null : label;
  }
  if (body.subjectTemplate !== undefined) {
    updates.subjectTemplate =
      typeof body.subjectTemplate === "string" && body.subjectTemplate !== ""
        ? body.subjectTemplate
        : null;
  }
  if (body.bodyTemplate !== undefined) {
    if (typeof body.bodyTemplate !== "string") {
      return Response.json({ error: "bodyTemplate must be a string." }, { status: 400 });
    }
    updates.bodyTemplate = body.bodyTemplate;
  }
  if (body.waitDaysAfterPrevious !== undefined) {
    const days = Number(body.waitDaysAfterPrevious);
    if (!Number.isInteger(days) || days < 0) {
      return Response.json(
        { error: "Wait days must be a whole number of 0 or more." },
        { status: 400 },
      );
    }
    updates.waitDaysAfterPrevious = days;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const [updated] = await db
    .update(sequenceStep)
    .set(updates)
    .where(eq(sequenceStep.id, stepId))
    .returning({ id: sequenceStep.id });
  if (!updated) {
    return Response.json({ error: "Step not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const stepId = Number(id);
  if (!Number.isInteger(stepId)) {
    return Response.json({ error: "Invalid step id." }, { status: 400 });
  }

  const [step] = await db
    .select({
      id: sequenceStep.id,
      campaignId: sequenceStep.campaignId,
      stepNumber: sequenceStep.stepNumber,
      variant: sequenceStep.variant,
    })
    .from(sequenceStep)
    .where(eq(sequenceStep.id, stepId));
  if (!step) {
    return Response.json({ error: "Step not found." }, { status: 404 });
  }

  // Dropping the B version of a step just removes that copy override —
  // the step itself survives and numbering is untouched.
  if (step.variant === "b") {
    await db.delete(sequenceStep).where(eq(sequenceStep.id, stepId));
    return Response.json({ ok: true });
  }

  if (step.stepNumber === 1) {
    return Response.json(
      { error: "Step 1 cannot be deleted — campaigns need an opening email." },
      { status: 400 },
    );
  }

  await db.transaction(async (tx) => {
    // Both variants of this step go, then everything after it shifts down.
    await tx
      .delete(sequenceStep)
      .where(
        and(
          eq(sequenceStep.campaignId, step.campaignId),
          eq(sequenceStep.stepNumber, step.stepNumber),
        ),
      );
    await tx
      .update(sequenceStep)
      .set({ stepNumber: sql`${sequenceStep.stepNumber} - 1` })
      .where(
        and(
          eq(sequenceStep.campaignId, step.campaignId),
          gt(sequenceStep.stepNumber, step.stepNumber),
        ),
      );
  });

  return Response.json({ ok: true });
}
