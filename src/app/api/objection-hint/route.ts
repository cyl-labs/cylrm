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
const ready = new Map<string, Ready>();

/** The `You say` lines from the script's opening section — the qualifying
 *  questions whose answers are information rather than objections. */
function openingQuestions(script: SopSection[]): string[] {
  const opener = script.find((s) => /opener/i.test(s.title));
  if (!opener) return [];
  return [...opener.responseHtml.matchAll(/<strong>You say<\/strong>\s*([^<]+)/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

/**
 * Which market's sheet to answer against.
 *
 * A caller assigned a market always gets theirs, whatever the browser asks for.
 * Only an account with no market — the founders', so it can work all of them —
 * is allowed to choose, which is the same rule the screen follows when it shows
 * them a picker and shows everybody else none.
 *
 * Resolving it here from `callRegionOf` alone was the bug: the screen fell back
 * and offered a choice, the route did not, so a founder saw the panel on the
 * left and "No objection sheet for this market" from the server.
 */
async function labelsFor(userId: number, wanted: string | null): Promise<Ready> {
  const mine = sopRegionFor(await callRegionOf(userId));
  const region = mine ?? (wanted === "sg" || wanted === "us" ? wanted : "us");
  const key = `${userId}:${region}`;
  const hit = ready.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const allowed = await canUseLiveHints(userId);
  if (!allowed) {
    const miss = { at: Date.now(), allowed: false, labels: [], expected: [], asking: [] };
    ready.set(key, miss);
    return miss;
  }
  const { objections, script } = await getDiallerSop(region);
  const fresh: Ready = {
    at: Date.now(),
    allowed: true,
    labels: objections,
    expected: script.flatMap((s) => s.prospectCues),
    asking: openingQuestions(script),
  };
  ready.set(key, fresh);
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
  const form = await request.formData().catch(() => null);
  const prospect = form?.get("prospect");
  const caller = form?.get("caller");
  const wanted = form?.get("market");

  const { allowed, labels, expected, asking } = await labelsFor(
    me.id,
    typeof wanted === "string" ? wanted : null,
  );
  if (!allowed) {
    return Response.json({ error: "No live hints access." }, { status: 403 });
  }
  if (labels.length === 0) {
    return Response.json({ error: "No objection sheet for this market." }, { status: 503 });
  }

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

  // Both the entry and its family. Measured on the regression set the two are
  // equally accurate — 39/40 either way, 20/20 on the cases that must match —
  // so pointing precisely costs nothing, and the family still frames it: when
  // the exact row is wrong the right one is usually the row above or below,
  // visibly in the same tinted group.
  //
  // That equality is a property of this design, not of the classifier. One
  // clean utterance with the caller's line for context is a far easier problem
  // than the continuous version faced, where it had to judge every fragment of
  // every call.
  const top = hint.candidates[0];
  const picked = top === undefined ? undefined : labels[top];
  return Response.json({
    heard: theirs.trim(),
    category: picked?.category ?? null,
    title: picked?.title ?? null,
  });
}
