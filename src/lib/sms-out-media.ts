import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Pictures we text out (2026-10-09).
 *
 * Telnyx sends a picture message from a **public link** it fetches itself, so
 * an uploaded picture has to live at an address Telnyx can reach. It is kept as
 * a file under `SMS_MEDIA_DIR`, the same folder that caches pictures people text
 * us, which is **outside `/root/crm`** on the droplet: `deploy.sh` rsyncs that
 * directory with `--delete`, so anything inside it is erased by the next deploy.
 * No table, so nothing to switch row security on for.
 *
 * The name is 192 random bits, which is the only thing keeping a prospect's
 * picture private: the link is served with no sign-in because Telnyx has none
 * to give. Never listed, never derived from anything guessable.
 */

/** Carriers cap a picture message at about 1 MB in all; this leaves room. */
export const OUT_MAX_BYTES = 900_000;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};
const TYPE: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif" };
const NAME = /^([a-f0-9]{48})\.(jpg|png|gif)$/;

/** The real type from the first bytes, never the label the browser sent. */
export function sniffImage(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (b.length > 6) {
    const head = b.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return null;
}

const dir = () =>
  path.join(process.env.SMS_MEDIA_DIR?.trim() || path.join(os.tmpdir(), "cylrm-sms"), "out");

/** Keep a picture and return the name its link is built from. */
export async function saveOutgoing(bytes: Buffer, contentType: string): Promise<string> {
  const ext = EXT[contentType];
  if (!ext) throw new Error("Unsupported picture type.");
  const name = `${randomBytes(24).toString("hex")}.${ext}`;
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), name), bytes, { flag: "wx" });
  return name;
}

export async function readOutgoing(
  name: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const m = NAME.exec(name);
  if (!m) return null;
  // `basename` as the backstop behind the pattern, the way the received-media
  // cache does it.
  const bytes = await readFile(path.join(dir(), path.basename(name))).catch(() => null);
  return bytes ? { bytes, contentType: TYPE[m[2]] } : null;
}

/**
 * What a send route needs from the `mediaId` the browser sent: the public link
 * Telnyx will fetch, and what to record. Null when there is no picture, an
 * `error` when there is one that cannot be sent.
 */
export async function resolveOutgoing(
  raw: unknown,
): Promise<
  { url: string; contentType: string; size: number } | { error: string } | null
> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !NAME.test(raw)) {
    return { error: "That picture is not available any more. Add it again." };
  }
  const file = await readOutgoing(raw);
  if (!file) return { error: "That picture is not available any more. Add it again." };
  const base = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!base) return { error: "Picture texts are not set up on this server." };
  return {
    url: `${base}/api/texts/out/${raw}`,
    contentType: file.contentType,
    size: file.bytes.length,
  };
}
