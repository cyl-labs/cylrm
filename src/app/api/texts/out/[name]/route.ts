import { readOutgoing } from "@/lib/sms-out-media";

/**
 * The public link Telnyx fetches to send a picture message (2026-10-09).
 *
 * **No sign-in, on purpose**: Telnyx has none to give, and `/api` is outside
 * the middleware matcher, so this answers anybody who has the name. The name is
 * 192 random bits and is never listed anywhere, which is the whole of the
 * protection; see `lib/sms-out-media.ts`. It serves only files that route wrote.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const file = await readOutgoing(name);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
