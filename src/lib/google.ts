import MailComposer from "nodemailer/lib/mail-composer";

// Endpoint overrides exist only so dev tests can point at a local mock —
// never set them in prod.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE =
  process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];

function clientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI must be set.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Thrown when the refresh token is expired/revoked (GCP Testing mode
 * expires them ~every 7 days) — the account must be reconnected. */
export class NeedsReconnectError extends Error {
  constructor(email: string) {
    super(
      `Google authorization for ${email} has expired or been revoked — reconnect the account via Google on the Accounts screen.`,
    );
    this.name = "NeedsReconnectError";
  }
}

export function buildAuthUrl(state: string, loginHint?: string): string {
  const { clientId, redirectUri } = clientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Force the consent screen so Google always returns a refresh token,
    // including on reconnects.
    prompt: "consent",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  code: string,
): Promise<{ refreshToken: string; email: string }> {
  const { clientId, clientSecret, redirectUri } = clientConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as {
    refresh_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.refresh_token) {
    throw new Error(
      `Google token exchange failed: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim(),
    );
  }
  // The connected account's email comes from the id_token (openid email
  // scopes). Payload only — signature verification is unnecessary here
  // because the token arrived directly from Google over TLS.
  let email = "";
  if (data.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8"),
      ) as { email?: string };
      email = payload.email?.toLowerCase() ?? "";
    } catch {
      // fall through
    }
  }
  if (!email) {
    throw new Error("Google did not return the account email in the id_token.");
  }
  return { refreshToken: data.refresh_token, email };
}

// Short-lived access tokens cached per refresh token, refreshed 2 min early.
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string, email: string): Promise<string> {
  const cached = accessTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 120_000) return cached.token;

  const { clientId, clientSecret } = clientConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new NeedsReconnectError(email);
    throw new Error(`Google token refresh failed: ${data.error ?? res.status}`);
  }
  accessTokenCache.set(refreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

export type GmailApiSendResult = {
  rfcMessageId: string;
  gmailMessageId: string;
  threadId: string | null;
};

/** Send one plain-text email via the Gmail API (messages.send over HTTPS —
 * unaffected by the droplet's SMTP port block). */
export async function sendViaGmailApi(params: {
  fromEmail: string;
  refreshToken: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<GmailApiSendResult> {
  const accessToken = await getAccessToken(params.refreshToken, params.fromEmail);

  const mime = await new MailComposer({
    from: params.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.text,
    inReplyTo: params.inReplyTo,
    references: params.references,
  })
    .compile()
    .build();

  const res = await fetch(`${GMAIL_API_BASE}/gmail/v1/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: mime.toString("base64url") }),
  });
  if (res.status === 401 || res.status === 403) {
    accessTokenCache.delete(params.refreshToken);
    throw new NeedsReconnectError(params.fromEmail);
  }
  const data = (await res.json()) as {
    id?: string;
    threadId?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    throw new Error(
      `Gmail API send failed (${res.status}): ${data.error?.message ?? "unknown error"}`,
    );
  }

  // MailComposer generated a Message-ID; read the delivered header back so
  // the stored rfc_message_id is authoritative for reply threading.
  let rfcMessageId = "";
  const mimeText = mime.toString("utf8");
  const localId = /^Message-ID:\s*(<[^>]+>)/im.exec(mimeText)?.[1];
  try {
    const meta = await fetch(
      `${GMAIL_API_BASE}/gmail/v1/users/me/messages/${data.id}?format=metadata&metadataHeaders=Message-ID`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (meta.ok) {
      const metaData = (await meta.json()) as {
        payload?: { headers?: { name: string; value: string }[] };
      };
      rfcMessageId =
        metaData.payload?.headers?.find(
          (h) => h.name.toLowerCase() === "message-id",
        )?.value ?? "";
    }
  } catch {
    // fall back to the locally generated id below
  }
  if (!rfcMessageId) rfcMessageId = localId ?? "";
  if (!rfcMessageId) {
    throw new Error("Could not determine the sent message's Message-ID header.");
  }

  return {
    rfcMessageId,
    gmailMessageId: data.id,
    threadId: data.threadId ?? null,
  };
}
