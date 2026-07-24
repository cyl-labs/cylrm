import { connect as tlsConnect } from "node:tls";

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

