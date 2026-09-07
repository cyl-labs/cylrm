/**
 * DocuSeal, the self-hosted signing service on the droplet.
 *
 * Only one thing is asked of it: take a template that already exists and make a
 * copy with the blanks filled in. Templates are not created from here — the
 * open-source build has no API for that (`POST /templates/pdf` and friends 404,
 * where the hosted service answers), so a new contract is uploaded and laid out
 * by hand in the editor once and addressed by id forever after.
 *
 * Unset config means the feature is off and nothing else changes, in the same
 * spirit as `lib/notify.ts` and the Cal.com sync: a screen that cannot draft a
 * contract must still render, and a missing token is never an exception thrown
 * at somebody reading their meetings.
 */

/** Where the API is reached. On the droplet that is the container on
 *  localhost, which is why it is not the same value as the link a person
 *  clicks — see `signingUrl`. */
const API = process.env.DOCUSEAL_URL?.replace(/\/+$/, "");
const TOKEN = process.env.DOCUSEAL_API_TOKEN;

/**
 * The host a human opens.
 *
 * Separate from `DOCUSEAL_URL` because that one is `http://localhost:3001` in
 * production — correct for a server-side fetch and useless in a browser. A link
 * built from the API base would be a dead link on every screen, so the public
 * host is its own value and falls back to the API base for local development,
 * where the two really are the same.
 */
const PUBLIC =
  process.env.DOCUSEAL_PUBLIC_URL?.replace(/\/+$/, "") ?? API ?? "";

/** Template ids, deliberately configuration rather than constants: rebuilding a
 *  template in the editor gives it a new id, and that should be an env change
 *  rather than a deploy. No defaults — a wrong default would draft somebody
 *  else's document, and this instance holds another business's contracts. */
export const TRIAL_TEMPLATE_ID = Number(
  process.env.DOCUSEAL_TEMPLATE_TRIAL ?? NaN,
);
export const PAID_TEMPLATE_ID = Number(
  process.env.DOCUSEAL_TEMPLATE_PAID ?? NaN,
);

/** Whatever is missing, named. The dialog says this out loud rather than
 *  failing on the press, since every one of these is an env value somebody has
 *  to go and set. */
export function docusealConfigError(): string | null {
  if (!API || !TOKEN) return "DocuSeal is not configured on this server.";
  if (!Number.isInteger(TRIAL_TEMPLATE_ID)) {
    return "No trial agreement template is configured.";
  }
  if (!Number.isInteger(PAID_TEMPLATE_ID)) {
    return "No paid agreement template is configured.";
  }
  return null;
}

export const docusealReady = () => docusealConfigError() === null;

/** The two roles on both templates. Sent as strings that must match the
 *  template's own role names character for character — DocuSeal attaches the
 *  fields by role name, and a mismatch produces a document with every field
 *  assigned to nobody rather than an error. */
export const SENDER_ROLE = "First Party";
export const SIGNER_ROLE = "Second Party";

export type Submitter = {
  role: string;
  email: string;
  name?: string;
  values?: Record<string, string>;
};

type SubmitterResponse = {
  slug: string;
  role: string;
  submission_id: number;
};

export type CreatedSubmission = {
  submissionId: number;
  /** The sender's own link — the one to open at the meeting, since Cyl Labs
   *  signs first. */
  senderSlug: string;
  signerSlug: string;
};

async function call<T>(
  path: string,
  init?: RequestInit & { body?: string },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "X-Auth-Token": TOKEN!,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `DocuSeal ${init?.method ?? "GET"} ${path} failed: ${res.status} ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Fill a template in and leave it sitting there.
 *
 * `send_email: false` is the whole point of this feature rather than a detail.
 * The contracts are drafted before a demo so they are ready when it starts;
 * nothing may reach the prospect until a person decides it should, and a
 * document that emailed itself the moment a caller pressed a button on the
 * meetings screen would be the worst possible failure here.
 */
export async function createSubmission(
  templateId: number,
  submitters: Submitter[],
): Promise<CreatedSubmission> {
  const rows = await call<SubmitterResponse[]>("/api/submissions", {
    method: "POST",
    body: JSON.stringify({
      template_id: templateId,
      send_email: false,
      send_sms: false,
      // Sender first, so DocuSeal's own ordering matches the way these are
      // signed in practice: Cyl Labs signs, then the client.
      submitters,
    }),
  });

  const sender = rows.find((r) => r.role === SENDER_ROLE);
  const signer = rows.find((r) => r.role === SIGNER_ROLE);
  if (!sender || !signer) {
    // A template whose roles have been renamed in the editor. Worth saying
    // precisely, because the document it produces looks fine and has no fields
    // attached to anybody.
    throw new Error(
      `DocuSeal template ${templateId} did not return both roles. Its roles must be named "${SENDER_ROLE}" and "${SIGNER_ROLE}".`,
    );
  }

  return {
    submissionId: sender.submission_id,
    senderSlug: sender.slug,
    signerSlug: signer.slug,
  };
}

/** The link a person opens. Built from the public host, never the API base. */
export const signingUrl = (slug: string) => `${PUBLIC}/s/${slug}`;
