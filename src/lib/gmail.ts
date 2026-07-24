import { connect as tlsConnect } from "node:tls";
import nodemailer from "nodemailer";

export const GMAIL_SMTP = { host: "smtp.gmail.com", port: 587 } as const;
export const GMAIL_IMAP = { host: "imap.gmail.com", port: 993 } as const;

/** Gmail shows app passwords as "abcd efgh ijkl mnop" — strip the spaces. */
export function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

const VERIFY_TIMEOUT_MS = 15_000;

/**
 * Verify a Gmail app password with an IMAP LOGIN against imap.gmail.com:993.
 * The same credential is used for SMTP sending, but verification runs over
 * IMAP because the DigitalOcean droplet blocks outbound SMTP ports
 * (25/465/587) while IMAP 993 is open.
 */
export async function verifyGmailAppPassword(
  email: string,
  appPassword: string,
): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: GMAIL_IMAP.host,
      port: GMAIL_IMAP.port,
      servername: GMAIL_IMAP.host,
    });
    let buffer = "";
    let loginSent = false;
    let settled = false;

    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `Timed out reaching Gmail IMAP (${GMAIL_IMAP.host}:${GMAIL_IMAP.port}). Check the server's network and try again.`,
      });
    }, VERIFY_TIMEOUT_MS);

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (!loginSent) {
        if (buffer.includes("* OK")) {
          loginSent = true;
          buffer = "";
          // Safe to inline: email is regex-validated upstream and the
          // normalized app password is alphanumeric.
          socket.write(`a1 LOGIN "${email}" "${appPassword}"\r\n`);
        }
        return;
      }
      if (/^a1 OK/m.test(buffer)) {
        socket.write("a2 LOGOUT\r\n");
        finish({ ok: true });
      } else if (/^a1 NO/m.test(buffer)) {
        finish({
          ok: false,
          error: `Gmail rejected the credentials for ${email}. Double-check the app password, and that 2-Step Verification is on and the app password was generated for this exact account.`,
        });
      } else if (/^a1 BAD/m.test(buffer)) {
        finish({
          ok: false,
          error: "Gmail could not process the login request. Check the email address for stray characters.",
        });
      }
    });

    socket.on("error", (err) => {
      finish({
        ok: false,
        error: `Could not reach Gmail IMAP (${err.message}). Check the server's network and try again.`,
      });
    });
  });
}

export class SmtpBlockedError extends Error {
  constructor(public code: string) {
    super(
      `Connection to ${GMAIL_SMTP.host}:${GMAIL_SMTP.port} failed (${code}) — outbound SMTP from this server is likely still blocked at the network level.`,
    );
    this.name = "SmtpBlockedError";
  }
}

export class SmtpAuthError extends Error {
  constructor(email: string) {
    super(
      `Gmail rejected the stored app password for ${email}. Reconnect the account with a fresh app password.`,
    );
    this.name = "SmtpAuthError";
  }
}

export type SendGmailResult = {
  /** The RFC 5322 Message-ID header, angle brackets included. */
  rfcMessageId: string;
};

/**
 * Send one plain-text email through Gmail SMTP (587, STARTTLS).
 * Throws SmtpBlockedError on connection failure, SmtpAuthError on bad
 * credentials; other errors propagate as-is.
 *
 * GMAIL_SMTP_HOST/GMAIL_SMTP_PORT/GMAIL_SMTP_INSECURE env vars redirect
 * sends to a local sink for dev testing only — never set them in prod.
 */
export async function sendGmail(params: {
  fromEmail: string;
  appPassword: string;
  to: string;
  subject: string;
  text: string;
  /** rfc_message_id of the message being replied to (angle brackets included). */
  inReplyTo?: string;
  /** rfc_message_ids of the whole thread, oldest first. */
  references?: string[];
}): Promise<SendGmailResult> {
  const transporter = nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST ?? GMAIL_SMTP.host,
    port: Number(process.env.GMAIL_SMTP_PORT ?? GMAIL_SMTP.port),
    secure: false,
    requireTLS: process.env.GMAIL_SMTP_INSECURE !== "1",
    auth: { user: params.fromEmail, pass: params.appPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  try {
    const info = await transporter.sendMail({
      from: params.fromEmail,
      to: params.to,
      subject: params.subject,
      text: params.text,
      inReplyTo: params.inReplyTo,
      references: params.references,
    });
    return { rfcMessageId: info.messageId };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EAUTH") throw new SmtpAuthError(params.fromEmail);
    if (
      code === "ETIMEDOUT" ||
      code === "ESOCKET" ||
      code === "ECONNECTION" ||
      code === "EDNS"
    ) {
      throw new SmtpBlockedError(code);
    }
    throw err;
  } finally {
    transporter.close();
  }
}
