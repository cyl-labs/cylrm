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
  createSubmission,
  docusealConfigError,
  PAID_TEMPLATE_ID,
  SENDER_ROLE,
  SIGNER_ROLE,
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

/** A trade reads better lowercase in the middle of a sentence — the contract
 *  says "the Client operates a ___ business", and niches are filed as "Movers"
 *  or "Aircon Servicing SG". The market suffix goes too: it is a filing label,
 *  not part of what the business does. Only a default; the dialog can override
 *  it, and does whenever the niche is not a noun that fits the sentence. */
export function tidyNiche(niche: string | null): string {
  if (!niche) return "";
  return niche
    .replace(/\s+(SG|US|GB|UK)$/i, "")
    .trim()
    .toLowerCase();
}

/** The date on the contract, as a plain calendar date in the reader's own
 *  clock. Never `new Date().toISOString()`: the droplet runs UTC, so a demo at
 *  9am Singapore would be drafted with yesterday's date on it. */
export function contractDate(at: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD, which is what DocuSeal's date field wants.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
}

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
