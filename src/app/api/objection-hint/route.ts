import { getCurrentUser } from "@/lib/session";
import { callRegionOf, canUseLiveHints } from "@/lib/users";
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
const MAX_HISTORY = 6;

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Gated on the flag as well as the key, so `LIVE_HINTS` is genuinely the one
  // switch that turns this off — the rollback plan depends on that being true.
  if (!objectionMatchConfigured()) {
    return Response.json({ error: "Live hints are off." }, { status: 503 });
  }
  if (!(await canUseLiveHints(me.id))) {
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

  const region = sopRegionFor(await callRegionOf(me.id));
  const { objections, script } = await getDiallerSop(region);

  // Objections AND the script. Not an enrichment — without the script the
  // classifier is structurally unable to be right about a whole class of thing.
  // "I pick up my own calls" is script beat C when it answers the opener's
  // "what happens to your calls?", and the "I answer all of them anyway"
  // objection when it is pushback after the pitch. Same words, different
  // answer depending on where in the call you are; offered only the objection
  // list the model must either mislabel it or stay silent, and in testing it
  // did both.
  //
  // A script section earns a place when it is keyed to something the prospect
  // says — it quotes them, or it is a branch. The forward beats ("Once they say
  // yes") are steps the caller takes and match nothing.
  //
  // Their titles cannot be the label, though: they describe what the caller
  // does ("Their answer will be one of these three"), and the three answers
  // being named are `###` sub-beats that never become sections. So a script
  // label is built from its prospect cues, which is where "I answer them"
  // actually lives.
  const labels = [
    ...objections,
    ...script
      .filter((s) => s.prospectCues.length > 0 || s.branch)
      .map((s) =>
        s.prospectCues.length > 0
          ? { ...s, title: `Prospect says ${s.prospectCues.join(" / ")}` }
          : s,
      ),
  ];
  if (labels.length === 0) return Response.json({ seq, matches: [], heard: "" });

  const hint = await matchObjection(labels, history, utterance);

  // The matched sections themselves, not indices into a list the browser would
  // have to rebuild identically. Two arrays that must stay aligned is exactly
  // the kind of coupling that breaks quietly when one side gains an entry.
  return Response.json({
    seq,
    heard: hint.heard,
    matches: hint.candidates.map((i) => labels[i]),
  });
}
