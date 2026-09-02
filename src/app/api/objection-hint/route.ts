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

/** The `You say` lines from the script's opening section — the qualifying
 *  questions whose answers are information rather than objections. */
function openingQuestions(script: { title: string; responseHtml: string }[]): string[] {
  const opener = script.find((s) => /opener/i.test(s.title));
  if (!opener) return [];
  return [...opener.responseHtml.matchAll(/<strong>You say<\/strong>\s*([^<]+)/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
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

  // Objections only. The script is deliberately NOT in the label set.
  //
  // It was, briefly, on the reasoning that "I pick up my own calls" is a script
  // beat early in a call and an objection later. That reasoning is sound and
  // the conclusion was still wrong, for a reason a live call made obvious: the
  // script is *already on screen* in the panel beside this card, so matching to
  // it tells the caller something they can already see. Worse, the section it
  // matched — "Their answer will be one of these three" — is a routing step
  // whose entire instruction is "whatever they say, go to the next section". It
  // has no answer of its own, so the card rendered three prospect quotes and
  // nothing to say.
  //
  // The objections are the thing this feature exists for, because they are the
  // thing that is hidden in a drawer. Anything already visible does not need a
  // card.
  const labels = objections;

  if (labels.length === 0) return Response.json({ seq, matches: [], heard: "" });

  // The script's expected answers — "They go to voicemail", "I answer them" —
  // are told to the classifier as things to stay quiet about. Derived from the
  // script document, so editing it keeps this in step with no code change.
  const expected = script.flatMap((s) => s.prospectCues);
  // The caller's own opening questions. When the last thing the caller said was
  // one of these, whatever comes back is the prospect answering a qualifying
  // question — information the pitch is built on, not a reason not to buy.
  //
  // A sharper signal than listing the expected answers, because it keys on what
  // the CALLER said, which is scripted and therefore predictable, rather than
  // on paraphrases of what the prospect might say back.
  const asking = openingQuestions(script);
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
