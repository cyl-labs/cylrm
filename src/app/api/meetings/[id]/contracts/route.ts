import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";
import {
  draftContracts,
  type ContractKind,
  type DraftInput,
} from "@/lib/contracts";
import { signingUrl } from "@/lib/docuseal";
import { packageById, termById } from "@/lib/packages";

const KINDS: readonly ContractKind[] = ["trial", "paid"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Draft the trial and paid agreements for a booked demo.
 *
 * Everything the contracts need is already on the meeting, but the values come
 * back from the browser rather than being re-read here — because the point of
 * the dialog is that a person looked at them. The business name in particular
 * arrives from a directory scrape as a trading name, and the one that goes on
 * a signed agreement is whatever they corrected it to.
 *
 * Nothing is emailed. `createSubmission` sends `send_email: false`, so the
 * documents sit in DocuSeal filled in and unsent until somebody decides
 * otherwise — see the note there, since that is the feature rather than a
 * detail.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return Response.json({ error: "Nothing to draft." }, { status: 400 });
  }

  // Scoped exactly as the follow-up route is: a caller naming a meeting on
  // somebody else's niche gets the same not-found as one that never existed.
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  const input: DraftInput = {
    businessName: str(body.businessName),
    nicheName: str(body.nicheName),
    signeeName: str(body.signeeName),
    signeeEmail: str(body.signeeEmail),
    effectiveDate: str(body.effectiveDate),
    packageId: str(body.packageId),
    termId: str(body.termId),
    kinds: Array.isArray(body.kinds)
      ? (body.kinds.filter((k) =>
          KINDS.includes(k as ContractKind),
        ) as ContractKind[])
      : [...KINDS],
  };

  // Checked here and not only in the browser: a contract with an empty party
  // name is the one mistake this whole feature exists to prevent, and a
  // disabled button is not a validation.
  if (!input.businessName) {
    return Response.json(
      { error: "The client's business name is required." },
      { status: 400 },
    );
  }
  if (!input.signeeEmail) {
    return Response.json(
      { error: "An email address is required for the person signing." },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    return Response.json({ error: "Invalid date." }, { status: 400 });
  }
  if (!packageById(input.packageId) || !termById(input.termId)) {
    return Response.json({ error: "Unknown package." }, { status: 400 });
  }
  if (input.kinds.length === 0) {
    return Response.json(
      { error: "Pick at least one agreement to draft." },
      { status: 400 },
    );
  }

  const result = await draftContracts(id, meeting.leadId, me.id, input);

  // A partial failure still returns what was made, so the screen can show a
  // real contract alongside the reason the other one is missing.
  const contracts = result.contracts.map((c) => ({
    kind: c.kind,
    existing: c.existing,
    url: signingUrl(c.senderSlug),
  }));

  if (!result.ok) {
    return Response.json({ error: result.error, contracts }, { status: 502 });
  }
  return Response.json({ ok: true, contracts });
}
