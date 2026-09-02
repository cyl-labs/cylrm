import { getCurrentUser } from "@/lib/session";
import { callRegionOf, canUseLiveHints } from "@/lib/users";
import { sopRegionFor } from "@/lib/calls";
import { getDiallerSop, type SopSection } from "@/lib/sop";
import {
  matchObjection,
  objectionMatchConfigured,
  transcribeClip,
} from "@/lib/objection-match";

/**
 * "What did they just say, and which section covers it?"
 *
 * One request per press, rather than a transcription session running for the
 * length of every call. Spotting that an objection has been raised is the
 * caller's job — somebody who cannot do that is not qualified for the work — so
 * this only saves them hunting for the response. It also cuts about nine tenths
 * of the cost: the old design classified all eleven-or-so things a prospect
 * said per call in order to produce two or three cards.
 *
 * Both sides are transcribed, because the caller's own last line is what tells
 * an answer apart from an objection: the script asks "does it go to voicemail?"
 * and the reply reads exactly like the "I answer all of them anyway" objection
 * without it. Measured on real calls, the caller's side silenced eleven false
 * positives with no incorrect silencing.
 */

const MAX_CLIP_BYTES = 2_000_000;

/**
 * The label set and this caller's access, cached per person for a minute.
 *
 * The SOP moves only on deploy and nobody edits a market mid-shift, so this
 * need not be three database round trips on every press. Short enough that
 * revoking access still bites while somebody is working, and the `LIVE_HINTS`
 * kill switch is read from the environment every request and never cached, so
 * it stays instant.
 */
const TTL_MS = 60_000;
type Ready = {
  at: number;
  allowed: boolean;
  labels: SopSection[];
  expected: string[];
  asking: string[];
};
const ready = new Map<number, Ready>();

/** The `You say` lines from the script's opening section — the qualifying
 *  questions whose answers are information rather than objections. */
function openingQuestions(script: SopSection[]): string[] {
  const opener = script.find((s) => /opener/i.test(s.title));
  if (!opener) return [];
  return [...opener.responseHtml.matchAll(/<strong>You say<\/strong>\s*([^<]+)/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

async function labelsFor(userId: number): Promise<Ready> {
  const hit = ready.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const allowed = await canUseLiveHints(userId);
  if (!allowed) {
    const miss = { at: Date.now(), allowed: false, labels: [], expected: [], asking: [] };
    ready.set(userId, miss);
    return miss;
  }
  const region = sopRegionFor(await callRegionOf(userId));
  const { objections, script } = await getDiallerSop(region);
  const fresh: Ready = {
    at: Date.now(),
    allowed: true,
    labels: objections,
    expected: script.flatMap((s) => s.prospectCues),
    asking: openingQuestions(script),
  };
  ready.set(userId, fresh);
  return fresh;
}

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Gated on the flag as well as the key, so `LIVE_HINTS` is genuinely the one
  // switch that turns this off — the rollback plan depends on that being true.
  if (!objectionMatchConfigured()) {
    return Response.json({ error: "Live hints are off." }, { status: 503 });
  }
  const { allowed, labels, expected, asking } = await labelsFor(me.id);
  if (!allowed) {
    return Response.json({ error: "No live hints access." }, { status: 403 });
  }
  if (labels.length === 0) {
    return Response.json({ error: "No objection sheet for this market." }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const prospect = form?.get("prospect");
  const caller = form?.get("caller");
  if (!(prospect instanceof Blob) || prospect.size === 0) {
    return Response.json({ error: "Nothing to listen to yet." }, { status: 400 });
  }
  if (prospect.size > MAX_CLIP_BYTES) {
    return Response.json({ error: "Clip too long." }, { status: 400 });
  }

  // Together: they are independent, and the caller waits on the slower one.
  const [theirs, ours] = await Promise.all([
    transcribeClip(prospect),
    caller instanceof Blob && caller.size > 0 && caller.size <= MAX_CLIP_BYTES
      ? transcribeClip(caller)
      : Promise.resolve(""),
  ]);

  if (!theirs.trim()) return Response.json({ heard: "", category: null });

  const hint = await matchObjection(
    labels,
    ours.trim() ? [{ speaker: "caller", text: ours.trim() }] : [],
    theirs.trim(),
    expected,
    asking,
  );

  // A category, never a single entry. One of seven families is a much easier
  // problem than one of nineteen entries, and a wrong family costs a glance at
  // three rows rather than a caller reading out a scripted answer to an
  // objection nobody raised.
  const top = hint.candidates[0];
  return Response.json({
    heard: theirs.trim(),
    category: top === undefined ? null : (labels[top]?.category ?? null),
  });
}
