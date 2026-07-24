import nodemailer from "nodemailer";

export const GMAIL_SMTP = { host: "smtp.gmail.com", port: 465 } as const;
export const GMAIL_IMAP = { host: "imap.gmail.com", port: 993 } as const;

/** Gmail shows app passwords as "abcd efgh ijkl mnop" — strip the spaces. */
export function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

/**
 * Verify a Gmail app password by authenticating against Gmail SMTP.
 * The same credential is used later for sending (SMTP) and polling (IMAP).
 */
export async function verifyGmailAppPassword(
  email: string,
  appPassword: string,
): Promise<VerifyResult> {
  const transporter = nodemailer.createTransport({
    host: GMAIL_SMTP.host,
    port: GMAIL_SMTP.port,
    secure: true,
    auth: { user: email, pass: appPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EAUTH") {
      return {
        ok: false,
        error: `Gmail rejected the credentials for ${email}. Double-check the app password, and that 2-Step Verification is on and the app password was generated for this exact account.`,
      };
    }
    return {
      ok: false,
      error: `Could not reach Gmail SMTP (${code ?? "unknown error"}). Check the server's network/outbound port ${GMAIL_SMTP.port} and try again.`,
    };
  } finally {
    transporter.close();
  }
}
