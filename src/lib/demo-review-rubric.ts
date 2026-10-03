/**
 * The yardstick a demo call is scored against (2026-10-03).
 *
 * Condensed from the mentor's "Sales Knowledge Base: NEPQ + Challenger" PDF
 * (28 Sep 2026): the NEPQ call stages, its objection pattern, and the three
 * Challenger moves with the six-step teaching sequence. Both halves are used,
 * at the founders' request. If the PDF is updated, change it here; the review's
 * fingerprint includes this text, so stored reviews then read as out of date.
 *
 * A third set of checks comes from the "Gong Files" PDF (Dial Club, Oct 2026):
 * what hundreds of thousands of recorded demos say about next steps, price and
 * talk time. It is correlation from mostly B2B software, so it is used as a
 * guide. ROI is deliberately NOT scored: Gong found presenting ROI lowers
 * close rates, but the "Closing the Demo" page is built around it, and which
 * way to go is a founders' decision.
 *
 * Tone of voice (curious, confused, concerned) is in the PDF but cannot be
 * heard in a transcript, so it is not scored.
 */

export const REVIEW_STAGES: {
  key: string;
  label: string;
  method: "NEPQ" | "Challenger" | "Gong";
  means: string;
}[] = [
  {
    key: "connecting",
    label: "Opening and getting them talking",
    method: "NEPQ",
    means:
      "Lowered the pressure, said why they were on the call, and handed the conversation to the prospect. Example: 'What made you take the time for this?'",
  },
  {
    key: "situation",
    label: "Learning how they run things now",
    method: "NEPQ",
    means:
      "A few short questions about how they handle calls today, without an interrogation. Example: 'How are you handling that right now?'",
  },
  {
    key: "problem",
    label: "Finding what is not working",
    method: "NEPQ",
    means:
      "Asked what they like and would change, and the PROSPECT named a problem in their own words. Example: 'Has that been causing any issues?'",
  },
  {
    key: "solution",
    label: "Hearing what they want instead",
    method: "NEPQ",
    means:
      "Got the prospect to describe the future they want. Example: 'If you could wave a magic wand, what would it look like?'",
  },
  {
    key: "consequence",
    label: "What it costs them to do nothing",
    method: "NEPQ",
    means:
      "Got the prospect to say what the problem costs and what happens if nothing changes. Example: 'What happens if this is still going on six months from now?'",
  },
  {
    key: "qualifying",
    label: "Is it urgent, and can they act",
    method: "NEPQ",
    means:
      "Checked how important it is to fix now, why now, and whether they can decide. Example: 'Why now? What makes this the right time?'",
  },
  {
    key: "transition",
    label: "Checking before pitching",
    method: "NEPQ",
    means:
      "Summed up their problem and goal in their own words, then asked permission to show the fix. Example: 'Based on what you shared, would it help if I showed you how we'd handle that?'",
  },
  {
    key: "presentation",
    label: "Showing the fix tied to their words",
    method: "NEPQ",
    means:
      "Showed only the parts that solve the problems they named, linking each to something they said. The live stretch where the AI receptionist takes a pretend customer call counts here.",
  },
  {
    key: "committing",
    label: "Letting them decide",
    method: "NEPQ",
    means:
      "Asked a question that let the prospect decide in their own words. Example: 'Do you feel this could be the answer? Why?' then 'Where do you want to go from here?'",
  },
  {
    key: "teach",
    label: "Telling them something new about their business",
    method: "Challenger",
    means:
      "Shared a surprising, relevant point that changed how they see the problem (for example that missed calls, not lead volume, is the leak), backed with a number or a story about a business like theirs, before naming the product.",
  },
  {
    key: "tailor",
    label: "Speaking to this owner's priorities",
    method: "Challenger",
    means:
      "Adjusted the message to what this particular owner cares about (growth, time, control, cost) instead of a generic pitch.",
  },
  {
    key: "control",
    label: "Steering the next steps and price",
    method: "Challenger",
    means:
      "Stayed in charge without being pushy: talked about price openly, kept momentum, and ended with a clear next step instead of letting it drift.",
  },
  {
    key: "nextsteps",
    label: "Agreeing the next step before hanging up",
    method: "Gong",
    means:
      "Before the call ended, a concrete next step was agreed (a start date, a time to set it up, a time to talk again), not left as 'I'll send you something'. Deals where next steps were not discussed on the call closed far less often.",
  },
  {
    key: "price",
    label: "How price was handled",
    method: "Gong",
    means:
      "Price came up in the later part of the call, not as the opening, and was stated plainly. The closer did not call it the 'list price', 'typical price' or 'standard price' (those invite haggling) and did not lead with a discount. If the price was the very first thing said, or came before the owner had said what the problem is, rate it partly at best.",
  },
  {
    key: "easyout",
    label: "Offering an easy way out",
    method: "Gong",
    means:
      "Lowered the owner's risk, for example a free trial, month to month with no contract, or cancel any time, and only offered what we can honour.",
  },
  {
    key: "usecase",
    label: "Starting the demo with what they care about",
    method: "Gong",
    means:
      "The demo opened short and started with the problem or call type the owner talked about most, kept it a back and forth, and did not dump every feature.",
  },
];

/** Passed to the model as the reference. */
export const RUBRIC_TEXT = [
  "REFERENCE: the mentor's sales method, in two halves.",
  "",
  "NEPQ. The rep gets the prospect to persuade themselves by asking questions, so the prospect says the problem out loud, feels what it costs, and describes the future they want. The rep is curious and relaxed about the outcome, never needy or pushy. Problem first, solution last: no pitching until the prospect has named the gap and wants it closed. Questions beat statements, because a claim can be doubted and the prospect's own answer cannot. Roughly 80% of a call should be the first six stages (opening, situation, problem, solution, consequence, qualifying). Pitching too early is the most common mistake. If the prospect has not described the cost of their problem, the rep is not ready to present. Too many fact questions in a row feels like an interrogation.",
  "",
  "NEPQ objections. Never argue. Acknowledge ('That's totally fair'), clarify ('When you say that, what do you mean exactly?'), then resolve with a question that points back to the problem and cost the prospect already described. Examples: 'too expensive' becomes 'Too expensive compared to what? And what is it costing you to leave this as is?'. 'I need to think about it' becomes 'Of course. What specifically do you want to think through?'. 'I need to talk to my partner' becomes 'If it were only up to you, what would you do? What do you think they will ask?'. 'Send me information' becomes 'Happy to. What part are you most interested in, so I send the right thing?'. 'We already work with someone' becomes 'What do you like about them? If you could change one thing, what would it be?'. 'Not a good time' becomes 'When would be better, and what would need to change before then?'.",
  "",
  "CHALLENGER. Top performers teach the buyer something new about their business, tailor it to the person, and take control of the sale. Teach: a surprising, relevant insight that leads back to what we do uniquely well. The teaching sequence is: (1) show you understand their world, (2) reframe ('most people think the problem is X, it is actually Y'), (3) back it with data that quantifies the cost, (4) a short story about a business like theirs, (5) describe the better way in general terms before naming the product, (6) then the solution. Tailor: match the message to this person's priorities (an owner hears growth and control, an operations person hears time and workload, finance hears cost and risk). Take control: assertive, not aggressive. Talk about money openly, keep the deal moving, push back on stalls instead of discounting, and end with a clear next step. Risk: teaching turns into lecturing.",
  "",
  "The two blend: teach to create the gap, then ask questions so the prospect puts a number on it in their own words.",
  "",
  "GONG DATA ON DEMOS AND CLOSING (correlation from recorded sales calls, mostly software, so a guide and not a law). Talk time: in a winning demo the seller talks about 65% of the time, versus about half on a discovery call. Do not mark a demo down for the closer talking a lot, but a long monologue with no back and forth is a weakness. Demos that keep a conversation (frequent switching of speakers, the owner asking questions) do better. Start with the use case the owner cared about most, keep the opening overview short, and do not feature dump. Next steps: agreeing what happens next on the call itself is one of the strongest signs of a deal closing. Price: bring it up later in the call, say it plainly, never say 'list price', 'typical price' or 'standard price', and do not lead with a discount. Risk reversal (trial, month to month, cancel any time) goes with higher close rates. 'I need to think about it' is common and does not mean the deal is dead, but it should be met with a question. Gong's objection steps: pause and do not pounce, clarify by asking what is behind it (avoid asking 'why'), say it is a fair concern, check nothing else is holding them back, ask permission with something like 'Can I bounce a few thoughts off you?' (not 'Can I make a suggestion?'), reframe, then ask what part still feels unaddressed instead of 'does that resolve it?' which invites a fake yes.",
].join("\n");
