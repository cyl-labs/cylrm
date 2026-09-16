import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/session";
import { findVisibleTextMedia } from "@/lib/texts";

/**
 * One picture or file somebody texted us.
 *
 * Telnyx's own url is a plain object in its S3 bucket and is **readable by
 * anybody who has it, with no credentials** — measured on 2026-09-16, and
 * sending the Telnyx bearer token actually makes S3 refuse it with a 400. So
 * that url is never handed to the browser: this route is the only way to the
 * bytes, and it asks who is looking first. The same reasoning built
 * `/api/recordings/[id]`, and the failure to avoid is identical — a link that
 * works for anyone who ever saw it, pointing at a prospect's photograph.
 *
 * Who may see one is `findVisibleTextMedia`, which is the conversation
 * scoping rule and not a second copy of it: an admin sees every thread, a
 * caller sees texts to their own number.
 *
 * **It is also a cache, and that is not an optimisation.** Telnyx's bucket
 * drops the object 30 days after it arrives (`x-amz-expiration`,
 * `rule-id="30Days"`), so a route that only ever proxied would work for a
 * month and then quietly stop. The first person to open an attachment writes
 * it to `SMS_MEDIA_DIR`; everyone after reads the local copy, and it survives
 * the expiry. Nothing is fetched speculatively — an attachment nobody opens is
 * never downloaded, which is what keeps this cheap on a 1 vCPU box.
 *
 * Unset `SMS_MEDIA_DIR` means no caching and nothing else changes: it proxies
 * live, which is correct in local dev and correct for the first 30 days
 * anywhere. **On the droplet it must point outside `/root/crm`** — `deploy.sh`
 * rsyncs that directory with `--delete`, so a cache inside it is erased by the
 * next deploy.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  // Index rather than a filename: one text can carry several attachments, and
  // a name from the payload is attacker-supplied text on a path.
  const index = Number(new URL(request.url).searchParams.get("i") ?? "0");
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const item = await findVisibleTextMedia(messageId, index, me);
  if (!item) return Response.json({ error: "Not found." }, { status: 404 });

  const type = item.contentType || "application/octet-stream";
  const dir = process.env.SMS_MEDIA_DIR?.trim();
  // Telnyx sends a sha256 and it names the file, but it is still a value off
  // the wire, so it is only used when it looks like one; anything else falls
  // back to a name built from our own ids. `path.basename` is the backstop
  // against a traversal that gets past the pattern.
  const safe = /^[a-f0-9]{64}$/.test(item.hash ?? "")
    ? (item.hash as string)
    : createHash("sha256").update(`${messageId}:${index}`).digest("hex");
  const file = dir ? path.join(dir, path.basename(safe)) : null;

  if (file) {
    const cached = await readFile(file).catch(() => null);
    if (cached) return send(cached, type);
  }

  const res = await fetch(item.url).catch(() => null);
  if (!res?.ok) {
    // Past the 30 days, or Telnyx having a bad minute. Said plainly rather
    // than as a broken image, because those are different problems.
    return Response.json(
      { error: "That attachment is no longer available." },
      { status: 404 },
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  if (file && dir) {
    // Best effort on purpose: a cache that cannot be written must not stop
    // somebody looking at the picture they asked for.
    await mkdir(dir, { recursive: true })
      .then(() => writeFile(file, bytes))
      .catch(() => {});
  }
  return send(bytes, type);
}

/** Private, not public: this is one customer's photograph behind a login, so
 *  no shared cache may hold it. Immutable because the bytes never change —
 *  the browser re-asking costs a round trip through the auth check, and the
 *  content is addressed by a row that is never rewritten. */
function send(bytes: Buffer, type: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400, immutable",
      // It is a prospect's file of unknown provenance. Never let a browser
      // decide it is HTML and run it on our origin.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:",
    },
  });
}
