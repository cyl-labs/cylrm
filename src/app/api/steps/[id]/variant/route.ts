import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sequenceStep } from "@/db/schema";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

/**
 * Add a B version to a step, for an A/B copy test inside one campaign.
 *
 * The new row starts as a copy of the A version's subject and body so the
 * test is a deliberate edit away rather than a blank page — the point is
 * "same email, slightly different wording". Timing is not copied: wait days
 * always come from the A row, so the two arms can never drift apart on
 * anything but wording.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const { id } = await params;
  const stepId = Number(id);
  if (!Number.isInteger(stepId)) {
    return Response.json({ error: "Invalid step id." }, { status: 400 });
  }

  const [source] = await db
    .select({
      campaignId: sequenceStep.campaignId,
      stepNumber: sequenceStep.stepNumber,
      variant: sequenceStep.variant,
      subjectTemplate: sequenceStep.subjectTemplate,
      bodyTemplate: sequenceStep.bodyTemplate,
    })
    .from(sequenceStep)
    .where(eq(sequenceStep.id, stepId));
  if (!source) {
    return Response.json({ error: "Step not found." }, { status: 404 });
  }
  if (source.variant !== "a") {
    return Response.json(
      { error: "A step can only have one B version." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: sequenceStep.id })
    .from(sequenceStep)
    .where(
      and(
        eq(sequenceStep.campaignId, source.campaignId),
        eq(sequenceStep.stepNumber, source.stepNumber),
        eq(sequenceStep.variant, "b"),
      ),
    );
  if (existing) {
    return Response.json(
      { error: "This step already has a B version." },
      { status: 409 },
    );
  }

  const [created] = await db
    .insert(sequenceStep)
    .values({
      campaignId: source.campaignId,
      stepNumber: source.stepNumber,
      variant: "b",
      waitDaysAfterPrevious: 0,
      subjectTemplate: source.subjectTemplate,
      bodyTemplate: source.bodyTemplate,
    })
    .returning();

  return Response.json({ step: created });
}
