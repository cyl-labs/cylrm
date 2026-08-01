import { eq } from "drizzle-orm";
import { db } from "@/db";
import { call, callLead } from "@/db/schema";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

const OUTCOMES = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "not_interested",
  "interested",
  "demo_booked",
  "bad_number",
] as const;
type Outcome = (typeof OUTCOMES)[number];

const isOutcome = (v: unknown): v is Outcome =>
  typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const body = (await request.json().catch(() => null)) as {
    callLeadId?: unknown;
    outcome?: unknown;
    notes?: unknown;
    callbackAt?: unknown;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const leadId = Number(body.callLeadId);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }
  if (!isOutcome(body.outcome)) {
    return Response.json({ error: "Unknown call outcome." }, { status: 400 });
  }

  const [lead] = await db
    .select({ id: callLead.id })
    .from(callLead)
    .where(eq(callLead.id, leadId));
  if (!lead) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  // A callback with no time would sit in the queue forever with nothing to
  // sort it by, so it defaults to tomorrow rather than being rejected — the
  // caller is mid-flow and should not be stopped by a form error.
  let callbackAt: Date | null = null;
  if (body.outcome === "callback") {
    const parsed =
      typeof body.callbackAt === "string" && body.callbackAt !== ""
        ? new Date(body.callbackAt)
        : null;
    callbackAt =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 5000)
      : null;

  const [row] = await db
    .insert(call)
    .values({ callLeadId: leadId, outcome: body.outcome, notes, callbackAt })
    .returning({ id: call.id, calledAt: call.calledAt });

  return Response.json({
    id: row.id,
    calledAt: row.calledAt.toISOString(),
    outcome: body.outcome,
  });
}
