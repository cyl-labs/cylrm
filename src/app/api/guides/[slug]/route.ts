import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getCurrentUser } from "@/lib/session";

/**
 * A video guide, streamed to somebody signed in.
 *
 * The file is **not in the repo**. A screen recording is over a hundred
 * megabytes, and a file that size in git is in every clone and every deploy
 * from then on; `deploy.sh` also rsyncs the repo with `--delete`, so anything
 * kept inside it would be shipped up and down on every release. It lives in
 * `GUIDE_DIR` on the droplet instead, beside the text-message media cache and
 * for the same reason.
 *
 * Behind the login because it is a tour of the CRM: real businesses, real
 * numbers, and the prices on the Payroll screen. A public URL is one paste
 * away from being a link anybody can open.
 *
 * Range requests are answered properly, or the player cannot seek and Safari
 * will not play at all: it asks for `bytes=0-1` first and expects a 206.
 */

/** Unset means no guides and nothing else changes — the same rule
 *  `SMS_MEDIA_DIR` and every other optional path here follow. */
const dir = () => process.env.GUIDE_DIR?.trim() || null;

/** Slugs name a file, so nothing but a plain name is allowed near the path. */
const isSlug = (v: string) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(v);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const root = dir();
  const { slug } = await params;
  if (!root || !isSlug(slug)) {
    return Response.json({ error: "No such guide." }, { status: 404 });
  }

  const file = path.join(root, `${slug}.mp4`);
  // Belt and braces with the slug check: resolve and confirm it is still
  // inside the directory, so no clever name can walk out of it.
  if (!path.resolve(file).startsWith(path.resolve(root) + path.sep)) {
    return Response.json({ error: "No such guide." }, { status: 404 });
  }

  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return Response.json({ error: "No such guide." }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // Private: it is per-person only in the sense that it needs a session, and
    // a shared cache must not hold it.
    "Cache-Control": "private, max-age=3600",
  };

  const range = request.headers.get("range");
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }
    const stream = Readable.toWeb(
      createReadStream(file, { start, end }),
    ) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}
