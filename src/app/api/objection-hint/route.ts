import { getCurrentUser } from "@/lib/session";
import { callRegionOf, canUseLiveHints } from "@/lib/users";
import type { SopSection } from "@/lib/sop";
import { sopRegionFor } from "@/lib/calls";
import { getDiallerSop } from "@/lib/sop";
import {
  matchObjection,
  objectionMatchConfigured,
  type HintTurn,
} from "@/lib/objection-match";

/**
 * Which script fits what the prospect just said.
 *
 * The label set is built here, server-side, from the caller's own market — so
 * the browser sends speech and never a list of objections it could get wrong or
 * stale. The indices returned are positions in `getDiallerSop().objections`,
 * which is the same array the dialler already holds, so the two cannot drift.
 */

const MAX_UTTERANCE = 1_000;

/**
 * The label set and this caller's access, cached per person for a minute.
 *
 * This runs once per thing the prospect says, and each call was making three
 * database round trips — the access check, the caller's market, and the SOP
 * documents. React's `cache()` only dedupes within a single request, so across
 * separate ones they all re-queried. None of it can change mid-call: the SOP
 * only moves on deploy, and a market or a grant is not edited between two
 * sentences.
 *
 * A minute is short enough that revoking access still bites while somebody is
 * still on the phone, and the `LIVE_HINTS` kill switch is read from the
 * environment on every request and is not cached at all.
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


const MAX_HISTORY = 6;

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

  const body = (await request.json().catch(() => null)) as {
    utterance?: unknown;
    history?: unknown;
    seq?: unknown;
  } | null;

  const utterance =
    typeof body?.utterance === "string" ? body.utterance.trim().slice(0, MAX_UTTERANCE) : "";
  if (!utterance) return Response.json({ error: "Nothing to match." }, { status: 400 });

  // Echoed back untouched so the browser can drop a response that arrives after
  // a newer one — utterances land seconds apart and can return out of order.
  const seq = Number.isInteger(body?.seq) ? (body!.seq as number) : 0;

  const history: HintTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter(
          (t): t is HintTurn =>
            typeof t === "object" &&
            t !== null &&
            (("speaker" in t && (t as HintTurn).speaker === "caller") ||
              (t as HintTurn).speaker === "prospect") &&
            typeof (t as HintTurn).text === "string",
        )
        .slice(-MAX_HISTORY)
        .map((t) => ({ speaker: t.speaker, text: t.text.slice(0, MAX_UTTERANCE) }))
    : [];

  if (labels.length === 0) return Response.json({ seq, matches: [], heard: "" });

  const hint = await matchObjection(labels, history, utterance, expected, asking);

  // The matched sections themselves, not indices into a list the browser would
  // have to rebuild identically. Two arrays that must stay aligned is exactly
  // the kind of coupling that breaks quietly when one side gains an entry.
  return Response.json({
    seq,
    heard: hint.heard,
    matches: hint.candidates.map((i) => labels[i]),
  });
}
