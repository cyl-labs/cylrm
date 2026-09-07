/**
 * Drafting the two agreements for a booked demo.
 *
 * Both have to exist, filled in, before the meeting starts: the trial if they
 * say yes on the call, the paid one if they skip the trial. Everything the
 * blanks need is already on the meeting row — the business name off the lead,
 * the signee and their email off the Cal.com booking, the trade off the list's
 * niche — so the only thing a person supplies is the package, and the only
 * thing they have to check is that the scraped business name is the name the
 * client actually signs under.
 *
 * That last part is why the dialog is prefilled and editable rather than one
 * press: `call_lead.company` is a directory scrape, so it is a trading name
 * ("AK Auto Care") where a contract wants the legal entity ("AK Auto Care LLC").
 * A wrong party name on a signed agreement is worse than the typing this
 * feature exists to remove.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  archiveSubmission,
  createSubmission,
  docusealConfigError,
  PAID_TEMPLATE_ID,
  SENDER_ROLE,
  SIGNER_ROLE,
  submissionState,
  TRIAL_TEMPLATE_ID,
} from "@/lib/docuseal";
import { contractValues, packageById, termById } from "@/lib/packages";

/** Who signs for Cyl Labs, and the DocuSeal account the drafts land in.
 *  Configuration rather than constants: the signatory is a person who can
 *  change, and the email has to be a real user on the DocuSeal instance or the
 *  documents belong to nobody. */
const SENDER_EMAIL = process.env.DOCUSEAL_SENDER_EMAIL ?? "";
const SENDER_NAME = process.env.DOCUSEAL_SENDER_NAME ?? "";

export type ContractKind = "trial" | "paid";

export type DraftInput = {
  /** The blanks, already checked by a person. Sent whole rather than re-derived
   *  here: what the dialog showed is what gets signed. */
  businessName: string;
  nicheName: string;
  signeeName: string;
  signeeEmail: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  packageId: string;
  termId: string;
  /** Which agreements to draft. Both, normally. */
  kinds: ContractKind[];
};

export type DraftedContract = {
  kind: ContractKind;
  senderSlug: string;
  signerSlug: string;
  submissionId: number;
  /** True when it already existed and nothing new was created. */
  existing: boolean;
};

export type DraftResult =
  | { ok: true; contracts: DraftedContract[] }
  | { ok: false; error: string; contracts: DraftedContract[] };

/**
 * Draft the agreements that do not exist yet.
 *
 * Sequential rather than batched, and each row is written the moment its
 * document is made. A failure part-way therefore leaves a real contract that
 * the screen can show and a message saying what did not happen — which beats
 * the alternative of a document sitting in DocuSeal that the CRM has no record
 * of and nobody will ever find.
 */
export async function draftContracts(
  meetingId: number,
  leadId: number | null,
  userId: number | null,
  input: DraftInput,
): Promise<DraftResult> {
  const configError = docusealConfigError();
  if (configError) return { ok: false, error: configError, contracts: [] };
  if (!SENDER_EMAIL) {
    return {
      ok: false,
      error: "No DocuSeal sender is configured on this server.",
      contracts: [],
    };
  }

  const pkg = packageById(input.packageId);
  const term = termById(input.termId);
  if (!pkg || !term) {
    return { ok: false, error: "Unknown package.", contracts: [] };
  }

  // What is already drafted. Read once rather than relying on the unique index
  // to reject a second press: the index would fire *after* DocuSeal had made a
  // duplicate document, which is the expensive half.
  const done = new Map<ContractKind, DraftedContract>();
  const rows = await db.execute(sql`
    select kind, submission_id, sender_slug, signer_slug
    from call_contract where meeting_id = ${meetingId}
  `);
  for (const r of rows as unknown as Record<string, unknown>[]) {
    done.set(r.kind as ContractKind, {
      kind: r.kind as ContractKind,
      submissionId: Number(r.submission_id),
      senderSlug: String(r.sender_slug),
      signerSlug: String(r.signer_slug),
      existing: true,
    });
  }

  const fees = contractValues(pkg, term);
  const made: DraftedContract[] = [];

  for (const kind of input.kinds) {
    const already = done.get(kind);
    if (already) {
      made.push(already);
      continue;
    }

    const templateId = kind === "trial" ? TRIAL_TEMPLATE_ID : PAID_TEMPLATE_ID;

    // The trial has no package: its fee is USD 1 and printed into the template,
    // so sending the fee fields would address blanks that are not there.
    const senderValues: Record<string, string> = {
      effective_date: input.effectiveDate,
      business_name: input.businessName,
      niche_name: input.nicheName,
      cyllabs_name: SENDER_NAME,
      ...(kind === "paid" ? fees : {}),
    };

    try {
      const created = await createSubmission(templateId, [
        {
          role: SENDER_ROLE,
          email: SENDER_EMAIL,
          name: SENDER_NAME || undefined,
          values: senderValues,
        },
        {
          role: SIGNER_ROLE,
          email: input.signeeEmail,
          name: input.signeeName || undefined,
          // Their printed name, so the signature block agrees with the party
          // named at the top rather than asking them to type it again.
          values: { client_name: input.signeeName },
        },
      ]);

      await db.execute(sql`
        insert into call_contract
          (meeting_id, call_lead_id, user_id, kind, submission_id,
           sender_slug, signer_slug, template_id, package_id, term_id,
           field_values)
        values (
          ${meetingId}, ${leadId}, ${userId}, ${kind}, ${created.submissionId},
          ${created.senderSlug}, ${created.signerSlug}, ${templateId},
          ${kind === "paid" ? pkg.id : null}, ${kind === "paid" ? term.id : null},
          ${JSON.stringify(senderValues)}::jsonb
        )
        -- Belt as well as braces: two people pressing at once both pass the
        -- read above, and only one can win the index. The loser's document is
        -- an orphan in DocuSeal rather than a second row here.
        on conflict (meeting_id, kind) do nothing
      `);

      made.push({ ...created, kind, existing: false });
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : `Could not draft the ${kind} agreement.`,
        contracts: made,
      };
    }
  }

  return { ok: true, contracts: made };
}

export type DiscardResult =
  | { ok: true; discarded: ContractKind[] }
  /** `reason` is what the caller branches on. The refusals here are not all
   *  faults — a signed agreement being left alone is the rule working — and
   *  reading that back out of the message text is the trap the Drizzle
   *  constraint-name gotcha documents. */
  | {
      ok: false;
      reason: "signed" | "nothing" | "failed";
      error: string;
      discarded: ContractKind[];
    };

/**
 * Throw a drafted agreement away so it can be drafted again.
 *
 * Drafting is deliberately once-only — the unique index and the read before it
 * exist so a second press cannot mint a second contract at a different price —
 * and that leaves one gap: a document drafted with the wrong business name, the
 * wrong package or the wrong signee had no way back. Correcting it meant
 * opening DocuSeal, which is a shared instance holding another business's
 * contracts. So this is the correction, one level in from the button, the same
 * way a mis-tapped call outcome is corrected rather than logged again.
 *
 * Two rules make it safe to offer at all:
 *
 * - **A signed agreement is never discarded.** DocuSeal is asked first, and any
 *   signature at all refuses the whole thing. At that point the document is not
 *   a draft, it is the deal, and this row is the only thing on our side that
 *   points at where it lives.
 * - **DocuSeal is archived before the row goes, never after.** The row is what
 *   makes a document findable; dropping it first would leave a filled-in
 *   contract live on a shared instance with nothing naming it.
 *
 * Sequential, and reporting what it managed, for the reason `draftContracts`
 * is: a partial result is a real state and the screen has to be able to show
 * it.
 */
export async function discardContracts(
  meetingId: number,
  kinds?: ContractKind[],
): Promise<DiscardResult> {
  const configError = docusealConfigError();
  if (configError) {
    return { ok: false, reason: "failed", error: configError, discarded: [] };
  }

  const rows = (await db.execute(sql`
    select kind, submission_id
    from call_contract where meeting_id = ${meetingId}
    order by kind
  `)) as unknown as Record<string, unknown>[];

  const wanted = rows
    .map((r) => ({
      kind: r.kind as ContractKind,
      submissionId: Number(r.submission_id),
    }))
    .filter((r) => !kinds || kinds.includes(r.kind));

  if (wanted.length === 0) {
    return {
      ok: false,
      reason: "nothing",
      error: "There is nothing drafted to discard.",
      discarded: [],
    };
  }

  const discarded: ContractKind[] = [];
  for (const { kind, submissionId } of wanted) {
    try {
      const state = await submissionState(submissionId);
      if (state.signedBy.length > 0) {
        return {
          ok: false,
          reason: "signed",
          error: `The ${kind} agreement has already been signed by ${state.signedBy.join(" and ")}. Signed documents are left alone — archive it in DocuSeal if you really mean to.`,
          discarded,
        };
      }
      if (!state.missing) await archiveSubmission(submissionId);
      await db.execute(sql`
        delete from call_contract
        where meeting_id = ${meetingId} and kind = ${kind}
      `);
      discarded.push(kind);
    } catch (err) {
      // Reaching DocuSeal is what makes both rules above true, so failing to
      // reach it keeps the row. A record pointing at a live document beats a
      // live document nothing points at.
      return {
        ok: false,
        reason: "failed",
        error:
          err instanceof Error
            ? err.message
            : `Could not discard the ${kind} agreement.`,
        discarded,
      };
    }
  }

  return { ok: true, discarded };
}
