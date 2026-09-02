import type { SopSection } from "@/lib/sop";

/**
 * Which objection is the prospect raising?
 *
 * Plain `fetch` against OpenAI, in the shape `deepgram.ts` established: no SDK,
 * a `configured()` gate so an unset key is a quiet 503 rather than a crash, and
 * errors that name the vendor.
 *
 * The label set is passed in rather than built here, and it comes from the SOP
 * documents — never a second hard-coded list. Editing `objections-us.md` and
 * deploying therefore changes what this knows, the same way `PICKUP` and
 * `STATS_ZONES` have exactly one home.
 *
 * Everything about the prompt below was settled by measurement against real
 * recordings, not by taste. The notes say which, because each rule is there to
 * stop a specific failure that was observed and would otherwise be "simplified"
 * back in.
 */

const API = "https://api.openai.com/v1/chat/completions";
/**
 * `gpt-4.1-mini`, chosen on measurement rather than price.
 *
 * On a 24-case regression set hand-labelled from real calls it scores 23/24
 * against gpt-5-nano's 22/24 — better recall (13/13 in-shortlist vs 11/13) for
 * one extra soft false positive — and it answers in ~1.0s where gpt-5-nano at
 * `reasoning_effort: "low"` takes ~4.1s. Four seconds is the difference between
 * a card arriving while the prospect is still talking and one arriving after
 * the caller has already had to answer them.
 *
 * Not a reasoning model, so it takes no `reasoning_effort`. That parameter is
 * why this comment is long: gpt-5-nano at "minimal" is ~1.2s and looked like a
 * free win on one utterance, but it is wrong on four of five real ones — it
 * fires "How much is it?" at "we close at six pm" — and it reached a live call
 * before anyone measured it properly. Change the model only against the
 * regression set, never against a single example.
 */
const MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 8_000;

/** How many candidates the caller is offered. Two, always — see `SHORTLIST`. */
export const SHORTLIST = 2;

/** Suppress a label that already fired for this call within this window.
 *
 *  Repetition, not error, was the dominant noise source measured across 47
 *  calls: prospects say the same thing several ways in a row ("we pick up
 *  24/7" / "a real human answers" / "you can call at three in the morning"),
 *  each is correctly classified, and the caller gets the same card four times.
 *  30s removes 27% of all suggestions; the curve is flat past it, and longer
 *  starts hiding genuine re-raises. */
export const REPEAT_COOLDOWN_MS = 30_000;

export type HintTurn = { speaker: "caller" | "prospect"; text: string };

export type Hint = {
  /** Indices into the sections array passed in, best first, at most SHORTLIST.
   *  Empty means nothing fits, which is the common and correct answer. */
  candidates: number[];
  /** Verbatim quote from the prospect that the match rests on.
   *
   *  Required rather than optional, and it does two jobs: a model made to point
   *  at words has a harder time justifying a match on "Bye-bye.", and it is
   *  what the caller reads to see at a glance that a hint is wrong. */
  heard: string;
};

export function objectionMatchConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.LIVE_HINTS === "1";
}

function systemPrompt(sections: SopSection[], expected: string[], asking: string[]): string {
  const list = sections
    .map((s, i) => `${i}. ${s.category ? `[${s.category}] ` : ""}${s.title}`)
    .join("\n");
  // The script's own `> **Prospect** "…"` lines, derived from the document
  // rather than listed here, so editing the script keeps this in step.
  const scripted = expected.length
    ? `\n\n**These answers are already handled by the caller's script. Return an EMPTY
list for them — even when an entry above looks like a match.** This rule wins
over the entry list. They are the replies the caller's own opening questions are
written to produce, so hearing one means the call is going to plan; the caller
is reading the script beside this card and does not need a second copy of a beat
they are already on.

This covers anything that MEANS the same, not only these exact words — "I answer
all my own calls", "I pick it up myself", "someone always answers", "we still
pick up after hours" are all the same answer as "I answer them":
${expected.map((e) => `- ${e}`).join("\n")}`
    : "";
  const qualifying = asking.length
    ? `\n\n**If the caller's last line was one of their scripted opening questions,
whatever the prospect says back is an ANSWER, not an objection. Return an empty
list.** These questions exist to find out how the business handles calls, and
the reply — "we close at six", "they go to voicemail", "no, I still pick up",
"I answer them myself" — is the information the pitch is built on. The caller
has not pitched anything yet, so there is nothing to object to. The questions:
${asking.map((q) => `- ${q}`).join("\n")}`
    : "";
  return `You help a cold caller on a live call. The caller is struggling to remember which script fits what the prospect just said.

Return a SHORTLIST of at most ${SHORTLIST} entries that might fit, best first.

An entry fits if the prospect is giving a REASON NOT TO BUY, or saying something
the caller needs a scripted answer for.

**Judge the content, not whether the caller prompted it.** The caller's script
deliberately asks "do you get missed calls?" and "does it go to voicemail?", so
an objection very often arrives as the ANSWER to a question. "I pick up all my
own calls anyway" is that objection even though the caller asked about it. Never
dismiss something merely because it answered a question.

Return an EMPTY list for:
- Backchannel and fragments: "yeah", "okay", "mm-hmm", "like,", "so..."
- Pure logistics carrying no reason not to buy: opening hours, an address,
  spelling an email, giving a name, confirming a time zone.
- Choosing or agreeing a time for the meeting: "Friday works", "mornings",
  "it would have to be Friday". That is the call going well.
- Politely ending a call that has already gone well.

**Confirming they miss calls is NOT an objection — it is the problem being sold
into.** "They go to voicemail", "calls go to voicemail after hours", "nobody
picks up after six", "we close at six" are the prospect agreeing they have the
gap. That is the call going WELL and the entry list has no answer for it.
The "I answer all of them anyway" entry is the OPPOSITE claim — that they do
NOT lose calls, because somebody always picks up — and it fires only on that.
Match the claim, never the topic: two sentences can both be about after-hours
calls and mean opposite things.

**The "who is this / what company are you with" entry is only for a challenge to
your identity** — them asking who YOU are, or refusing to hear you until they
know. A prospect asking what you want, what this has to do with their business,
or what service you need is not that; pick a different entry or none.

**"Too busy" means seasonal call volume, nothing else.** A prospect saying they
are out on a job, already on another call, or cannot always answer right away is
describing the gap this product fills — the problem being sold into, and the
answer the caller's own questions are digging for. That is not the busy-season
objection and usually not an objection at all.

**Objecting to the time it costs is NOT scheduling.** "Ten minutes is a bit of
a commitment", "we're too busy", "I don't have time for this" are the
too-busy objection, and they stay an objection even when the same sentence goes
on to agree — "that's a lot of time, but fine, I'll listen" is someone telling
you their hesitation out loud, which is exactly when the script is wanted.

${scripted}${qualifying}

Prefer an empty list over a weak match: a wrong hint costs more than no hint.
If it could be two, return both ranked — a short list the caller picks from
beats one confident wrong answer.

"heard" must be a verbatim quote from what the prospect just said, or "" when
the list is empty.

The entries:
${list}`;
}

/**
 * Ask which entry fits. Returns empty candidates on any failure.
 *
 * Never throws: this is called while somebody is on a live call, and a
 * classifier having a bad second must cost a missing hint and nothing else.
 */
export async function matchObjection(
  sections: SopSection[],
  history: HintTurn[],
  utterance: string,
  /** The script's own expected prospect answers. Anything matching one of these
   *  stays silent: the caller is reading the script beside this card and does
   *  not need a second copy of a beat they are already on. */
  expected: string[] = [],
  /** The caller's scripted opening questions. An answer to one of these is the
   *  prospect giving information, not raising an objection. */
  asking: string[] = [],
): Promise<Hint> {
  const empty: Hint = { candidates: [], heard: "" };
  const key = process.env.OPENAI_API_KEY;
  if (!key || sections.length === 0 || !utterance.trim()) return empty;

  const convo = history
    .map((t) => `${t.speaker === "caller" ? "Caller" : "Prospect"}: "${t.text}"`)
    .join("\n");

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt(sections, expected, asking) },
          {
            role: "user",
            content: `The conversation so far:\n${convo || "(start of call)"}\n\nProspect just said: "${utterance}"`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "shortlist",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                candidates: { type: "array", items: { type: "integer" } },
                heard: { type: "string" },
              },
              required: ["candidates", "heard"],
            },
          },
        },
      }),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Hint>;
    const candidates = (parsed.candidates ?? [])
      // The enum cannot be expressed in JSON Schema for a dynamic list, so an
      // out-of-range index is possible and must not index past the array.
      .filter((i) => Number.isInteger(i) && i >= 0 && i < sections.length)
      .slice(0, SHORTLIST);
    return { candidates, heard: String(parsed.heard ?? "").slice(0, 300) };
  } catch {
    // Timeout, network, or malformed JSON. No hint, no noise.
    return empty;
  }
}
