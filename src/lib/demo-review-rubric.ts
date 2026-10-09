/**
 * The yardstick a demo call is scored against (2026-10-03).
 *
 * Condensed from the mentor's "Sales Knowledge Base: NEPQ + Challenger" PDF
 * (28 Sep 2026): the NEPQ call stages and its objection pattern. Challenger
 * was dropped from scoring on 2026-10-04 (founders: our product is the same
 * every time, and Challenger fits custom, complex sales; it also contradicts
 * NEPQ on who leads). If the PDF is updated, change it here; the review's
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

/**
 * What our own SOP teaches for this call (2026-10-07), condensed from
 * `content/sop/procedure-closing-the-demo.md`. The review was scoring the demo
 * only against the mentor's NEPQ and Gong checklists, which know nothing about
 * how this call is meant to run, so it marked the closer down for the sample
 * coming first and missed the moves the SOP does ask for. It is the guide the
 * reviewer reads first; where it and the method below disagree, the SOP wins.
 * **If the SOP changes, change this**: it is part of the fingerprint, so old
 * reviews read as out of date.
 */
export const DEMO_SOP_TEXT = [
  "OUR OWN SOP FOR THIS CALL. This is how the closer is trained to run the demo. Judge the call against it first. Use the method below only where the SOP says nothing. If they disagree, the SOP wins.",
  "1. Ring on the minute of the booked time, never early. Talk as if the demo has already started, and do not say the company name.",
  "2. Before the agent is added, tell the owner it is only a SAMPLE, not built for their business, so they do not judge it as the real thing. Then add the agent to the call and play a pretend customer (a quote or a booking). The owner stays quiet and listens. The sample is generic on purpose.",
  "3. Straight after the demo, do NOT ask 'did you like it?'. Ask 'What did you think of how the call went? How is it different from your real calls?'. Then ask what a normal job is worth, and about how many calls they miss in a week. Numbers make the owner do the math. Working the cost out loud with their numbers is the SOP's way of summing up the problem before the package, so it counts for the 'checking before pitching' step.",
  "4. Do the math out loud with THEIR numbers (missed calls times job value) and let the number sit. Say no price yet. Then name the cheapest package that fits how many calls they get. Never sell a bigger one.",
  "5. Price: no discount, ever. Every plan is month to month. If they say it is too expensive, go back to the numbers they gave. If they say they get few calls, ask if they are listed as open 24 hours on Google. The 30 day trial is a backup only for an owner who heard the price and still hesitates. It is not the opener.",
  "6. Send the agreement while still on the phone. It already has their name on it. Walk through it together live so there is no confusion. It is short on purpose. The aim is to get it signed on the call.",
  "7. After it is signed: the form (the questions the agent is built from) and the next call, where they hear the agent working. They only pay after the agent is built and they have heard it. Never end on 'I will follow up': offer two times on two different days and book it.",
  "Things that are NOT faults on this call: showing the sample before asking the owner anything, the sample not being tied to the owner's words, no summing up before the sample, and the owner saying they only miss a few calls. The cold call already covered how they handle calls now (when they close, who answers after that, whether they looked at a voice agent), so do not mark the closer down for not asking it again, never suggest asking it as a fix or a next step, and rate the situation step done if the closer touched it and not_reached if not. Real gaps are things the SOP asks for that did not happen, for example never asking what the owner thought of the demo, saying a price before the math, selling a bigger package, offering a discount, or ending without a booked time.",
].join("\n");

export const REVIEW_STAGES: {
  key: string;
  label: string;
  method: "NEPQ" | "Gong" | "SOP";
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
      "Got the prospect to say what the problem costs and what happens if nothing changes. Example: 'What happens if this is still going on six months from now?' If the closer instead worked out the cost out loud with the prospect's own numbers (calls missed times job value), that is partly, never missed.",
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
      "Before naming the package or price, summed up their problem and goal in their own words and checked it was right. Example: 'Based on what you shared, would it help if I showed you how we'd handle that?' The sample demo at the start of the call is agreed and expected, so it is never marked down here and does not count as the pitch. On this call, working out the cost out loud with the owner's own numbers (calls missed times job value) and then naming the package counts as summing up, so that is done or partly, never missed.",
  },
  {
    key: "presentation",
    label: "Showing the fix tied to their words",
    method: "NEPQ",
    means:
      "Showed the parts that solve the problems they named, linking them to something they said (for example how they want to get the call details). The live stretch where the AI receptionist takes a pretend customer call counts here, and a generic sample at the start is not marked down for being generic.",
  },
  {
    key: "committing",
    label: "Letting them decide",
    method: "NEPQ",
    means:
      "Asked a question that let the prospect decide in their own words. Example: 'Do you feel this could be the answer? Why?' then 'Where do you want to go from here?'",
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
  {
    key: "sample",
    label: "Calling the demo a sample first",
    method: "SOP",
    means:
      "Before the agent was added, told the owner it is only a sample that is not built for their business, so they do not judge it as the real thing.",
  },
  {
    key: "reaction",
    label: "Asking what they thought of the demo",
    method: "SOP",
    means:
      "Right after the demo, asked the owner what they thought of how the call went or how it was different from their real calls, before moving on to numbers or price. 'Do you want to get started?' does not count. If the closer went straight from the demo to something else without asking, this is missed.",
  },
  {
    key: "agreement",
    label: "Sending the agreement and walking through it",
    method: "SOP",
    means:
      "While still on the call, sent the agreement and went through it with the owner so there was no confusion, aiming to get it signed on the call. If the call never reached that point, it is not_reached.",
  },
];

/** Passed to the model as the reference. */
export const RUBRIC_TEXT = [
  "REFERENCE: the mentor's sales method (NEPQ), then Gong's data on demos and closing.",
  "",
  "NEPQ. The rep gets the prospect to persuade themselves by asking questions, so the prospect says the problem out loud, feels what it costs, and describes the future they want. The rep is curious and relaxed about the outcome, never needy or pushy. Problem first, solution last: no pitching until the prospect has named the gap and wants it closed. Questions beat statements, because a claim can be doubted and the prospect's own answer cannot. Roughly 80% of a call should be the first six stages (opening, situation, problem, solution, consequence, qualifying). Pitching too early is the most common mistake. If the prospect has not described the cost of their problem, the rep is not ready to present. Too many fact questions in a row feels like an interrogation.",
  "",
  "NEPQ objections. Never argue. Acknowledge ('That's totally fair'), clarify ('When you say that, what do you mean exactly?'), then resolve with a question that points back to the problem and cost the prospect already described. Examples: 'too expensive' becomes 'Too expensive compared to what? And what is it costing you to leave this as is?'. 'I need to think about it' becomes 'Of course. What specifically do you want to think through?'. 'I need to talk to my partner' becomes 'If it were only up to you, what would you do? What do you think they will ask?'. 'Send me information' becomes 'Happy to. What part are you most interested in, so I send the right thing?'. 'We already work with someone' becomes 'What do you like about them? If you could change one thing, what would it be?'. 'Not a good time' becomes 'When would be better, and what would need to change before then?'.",
  "",
  "GONG DATA ON DEMOS AND CLOSING (correlation from recorded sales calls, mostly software, so a guide and not a law). Talk time: in a winning demo the seller talks about 65% of the time, versus about half on a discovery call. Do not mark a demo down for the closer talking a lot, but a long monologue with no back and forth is a weakness. Demos that keep a conversation (frequent switching of speakers, the owner asking questions) do better. Start with the use case the owner cared about most, keep the opening overview short, and do not feature dump. Next steps: agreeing what happens next on the call itself is one of the strongest signs of a deal closing. Price: bring it up later in the call, say it plainly, never say 'list price', 'typical price' or 'standard price', and do not lead with a discount. Risk reversal (trial, month to month, cancel any time) goes with higher close rates. 'I need to think about it' is common and does not mean the deal is dead, but it should be met with a question. Gong's objection steps: pause and do not pounce, clarify by asking what is behind it (avoid asking 'why'), say it is a fair concern, check nothing else is holding them back, ask permission with something like 'Can I bounce a few thoughts off you?' (not 'Can I make a suggestion?'), reframe, then ask what part still feels unaddressed instead of 'does that resolve it?' which invites a fake yes.",
].join("\n");

/**
 * The steps a caller's booking call (the cold call that wins the demo) is
 * scored on (2026-10-03). Built from the cold calling script
 * (`content/sop/script-us.md`), which callers are told to follow, plus the cold
 * calling findings in the "Gong Files" PDF. The script's own lines are NOT
 * marked down for being questions or for not matching the textbook: the script
 * is the house method here.
 */
export const BOOKING_STAGES: {
  key: string;
  label: string;
  method: "NEPQ" | "Gong" | "Script";
  means: string;
}[] = [
  {
    key: "reason",
    label: "Saying why they were calling",
    method: "Gong",
    means:
      "Opened the way the house script does, and gave the reason for the call if the owner asked for one. The script's own first line is 'Hello, can I ask what time you close today?', followed by what happens to calls after that, so a caller who opens that way has done this step: rate it done, never partly, and never write a fix that tells them to open differently. Rate it partly only if the owner asked what the call was about ('what is this about', 'who is this') and the caller did not answer with the script's reason ('I was calling to see how you handle your after hour calls'), or if the caller opened with the company name, 'how's your day going' or 'did I catch you at a bad time'.",
  },
  {
    key: "asked",
    label: "Asking the script's questions",
    method: "Script",
    means:
      "Asked what time they close, what happens to calls after that (voicemail, someone answers, the owner answers, and whether someone is paid to be on call), and whether they had considered a voice agent, and let the owner answer each one.",
  },
  {
    key: "listened",
    label: "Letting them do the talking",
    method: "NEPQ",
    means:
      "Asked and then actually listened: did not talk over the owner, did not answer their own question, and did not explain what a voice agent is unless the owner asked.",
  },
  {
    key: "problem",
    label: "Talking about their problem, not our product",
    method: "Gong",
    means:
      "Raised the owner's problem in plain, specific words (missed calls after hours, losing the job to whoever answered first) instead of buzzwords. The script's questions about what happens to calls after closing, and its line about a voice agent, are how the house method raises the problem, so asking them is done and is never marked down for not naming the problem outright. Rate it partly or missed only when the caller used jargon or talked about features in place of them. Plain problem language beat jargon about three to one in Gong's data.",
  },
  {
    key: "gatekeeper",
    label: "Getting past a gatekeeper",
    method: "Gong",
    means:
      "If someone other than the owner answered, the caller politely asked for the owner or whoever decides, and did not give the whole pitch to the wrong person. Not reached when the owner answered.",
  },
  {
    key: "stayed",
    label: "Staying in after a first no",
    method: "Gong",
    means:
      "When the owner pushed back ('not interested', 'we are fine', 'we do not get enough calls', 'just send me info'), the caller did not argue and did not just give up. They acknowledged it and answered with the house answer for it (see the reference): 'are you trying to capture more leads?' after a flat no, 'are you listed 24 hours on Google?' and the Google line for 'we do not get enough calls', and for 'send me info' saying the demo is better than an email and asking for 15 minutes. Giving the house answer is done, even when the caller used it in a slightly different order. Agreeing with the owner's no, or saying they would refuse the offer themselves, is partly at most. Taking an email on the owner's first ask, or a generic info@ or contact@ address, is partly at most. A call that books usually gets past at least two objections. Not reached if there was no objection.",
  },
  {
    key: "close",
    label: "Offering the demo the right way",
    method: "Script",
    means:
      "Used the script's close: not here to sell anything today, a demo was built for their business, the team will call and put the agent on the line so they can hear it. Did not say 'I'm not selling', did not offer to run the demo now, and did not offer to 'check if someone is free'. Not reached if the call never got that far.",
  },
  {
    key: "decider",
    label: "Knowing who decides",
    method: "Gong",
    means:
      "Made sure the person agreeing to the demo can actually decide (asked, or the person clearly said they run the business), or got the owner's name, so the demo is not booked with someone who cannot say yes. Someone simply saying yes does not count: if nobody checked, rate it missed. Not reached if there was no booking.",
  },
  {
    key: "timezone",
    label: "Asking their time zone before offering times",
    method: "Script",
    means:
      "Asked what time zone they are in BEFORE offering any times. Asking it after they have already named a time does not count. Not reached if no times were discussed.",
  },
  {
    key: "times",
    label: "Offering two times on two days",
    method: "Script",
    means:
      "Offered two specific times on two different days and asked which works better, instead of asking an open 'when are you free?'. Two times on the SAME day is partly, and it is not done however many times were offered that day. Read the day each time was offered for; do not assume the days differed. Not reached if no booking was attempted.",
  },
  {
    key: "readback",
    label: "Saying the day and time back with AM or PM",
    method: "Script",
    means:
      "Repeated the booked day and time back with AM or PM (morning or afternoon) spoken out loud in the read back itself, and read the email back letter by letter. Saying AM or PM only when first offering the times does not count for the read back. Reading back only the email, or only 'tomorrow, one thirty', is partly. Not reached if no booking was made.",
  },
];

export const BOOKING_RUBRIC_TEXT = [
  "REFERENCE: how a cold call that books a demo should go. Two sources.",
  "",
  "THE HOUSE SCRIPT is the method callers are trained on and it overrides any textbook. It opens by asking what time they close, then what happens to calls after that, then whether they have considered a voice agent, letting the owner answer each. It only explains what a voice agent is if the owner asks. The close says the caller is not trying to sell anything today, that a demo was built for the owner's business, and that the team will call and put the agent on the line. If the owner says 'you're selling me something' the caller agrees ('fair enough, this is what I do') and shrinks the promise, and never says 'I'm not selling'. If the owner wants to do it right now, the caller sounds pleased and says no (the team books ahead). Once the owner says yes: get name and email and read the email back, ask their time zone BEFORE offering any times, offer two times on two different days (never an open question), say the time back with AM or PM, and book it while they are on the phone. The caller never offers or hints at a price below the $99 list price, never promises the owner an answer on price, and never says they would turn the offer down themselves: a demo is booked, and price is for the team call. Doing any of these is the first thing to fix, ahead of every other step. On 'not interested' the caller says 'that's fair, can I ask one thing' and asks if they are trying to capture more leads. Calls that are voicemails, wrong numbers, or hang-ups early have nothing to score: mark the steps not_reached.",
  "",
  "HOUSE ANSWERS TO PUSHBACK (from the objection sheet; these are correct, so a caller who gives one has handled it, and no fix should replace it with a different question). 'We do not get enough calls to justify it': do not argue volume, ask 'Are you listed 24 hours on Google, by chance?', and if not say that Google ranks businesses that are open 24 hours a little higher on Maps, so an agent that picks up lets them show as always open and get more calls, then ask for 15 minutes this week. 'Just send me an email or some info': say they will get more out of hearing it, that a demo was built for their business and the team will call and put the agent on the line, and ask for 15 minutes this week. Only on a second ask do they take an email, and only a personal one with the owner's own name in it, never info@ or contact@. 'Not interested': 'that is fair, can I just ask one thing', then 'are you trying to capture more leads for your business right now?'. Never coach the caller to dig for pain the owner says they do not have.",
  "",
  "GONG DATA ON COLD CALLS (correlation from hundreds of millions of recorded calls, mostly software sellers, so a guide and not a law). A clear reason for the call makes success about twice as likely. 'Did I catch you at a bad time?' and 'how's your day going?' were the worst openers (they hand the owner an exit or sound like a telemarketer). Describing the prospect's pain in specific, plain words booked about three times as often as buzzwords and jargon. Successful cold calls last about six minutes versus three for failed ones, and a call that books usually survives at least two objections: folding at the first 'not interested' loses it. Most objections ('not interested', 'not for us', 'no budget', 'not my job') are reflexes at being interrupted, not real positions: do not argue, acknowledge and ask. Reaching a gatekeeper instead of the owner cuts the chance of booking by about 39%. On successful cold calls the caller talks about 55% of the time.",
  "",
  "NEPQ for 'not interested': 'No problem. Just curious, is that because you've already got this handled?' For 'we already have someone': 'What do you like about them? If you could change one thing, what would it be?' Never argue; clarify, then ask.",
].join("\n");

/**
 * The steps a follow-up call after a demo is scored on (2026-10-06).
 *
 * Found on a real review: Angel's call was the walkthrough of the trial
 * agreement, signed while on the phone, and the demo rubric marked it "missed"
 * on the cost of doing nothing and on whether he could act. By then he had
 * agreed to a trial. The question on this call is whether the trial will be
 * set up, kept and judged fairly, so the steps are about trust, the agreement,
 * the signature, what could stall it and the next call. NEPQ discovery is not
 * scored here; it is asked on the demo.
 */
export const FOLLOWUP_STAGES: {
  key: string;
  label: string;
  method: "NEPQ" | "Gong" | "Script" | "Follow-up";
  means: string;
}[] = [
  {
    key: "why",
    label: "Remembering why they said yes",
    method: "Follow-up",
    means:
      "Early on, checked what the owner wants out of the trial (the calls they never want to miss, the hours they want covered) in their own words, before going through the paperwork.",
  },
  {
    key: "trust",
    label: "Meeting doubts and trust worries",
    method: "Follow-up",
    means:
      "When the owner showed a doubt (been scammed before, does not really need it, wants to talk in person, worried about price), the closer acknowledged it calmly and answered with something concrete, such as no upfront payment, cancel any time, or what happens at the end of the trial. Nothing was brushed past.",
  },
  {
    key: "explain",
    label: "Explaining the agreement clearly",
    method: "Follow-up",
    means:
      "Went through what the agreement says in plain words (what the agent does, the trial length and limits, what happens if something breaks, what happens at the end, what it costs and when), and checked the owner understood rather than only reading it out.",
  },
  {
    key: "signing",
    label: "Getting it signed",
    method: "Follow-up",
    means:
      "Had the owner sign on the call, or agreed an exact time and way, and confirmed it went through.",
  },
  {
    key: "ready",
    label: "Getting the trial ready",
    method: "Follow-up",
    means:
      "Said exactly what happens next and who does what by when: the form, the phone number to use, how long it takes, when the trial clock starts. Asked the things that could hold it up (who sets up the number, what number, who else must be involved).",
  },
  {
    key: "success",
    label: "Agreeing what a good trial looks like",
    method: "Follow-up",
    means:
      "Agreed with the owner what would make the trial a success (for example never missing calls after closing time), so the end of trial call has something to point at.",
  },
  {
    key: "stall",
    label: "Catching what could stall it",
    method: "Follow-up",
    means:
      "Noticed signs the trial might stall (the owner says they do not really need it, depends on someone else, is busy, is hard to reach) and asked about them or put a safeguard in place, such as a check in call or a shorter deadline.",
  },
  {
    key: "next",
    label: "Booking the next call",
    method: "Follow-up",
    means:
      "Agreed the date, time and reason for the next call, in the owner's time zone, before hanging up.",
  },
  {
    key: "credible",
    label: "Staying professional and credible",
    method: "Follow-up",
    means:
      "Said nothing that weakens trust: no complaining about our own tools or bugs, no oversharing about being abroad or in a different time zone when the owner has just voiced scam worries, no promise that cannot be kept, no wrong statement about the terms.",
  },
];

export const FOLLOWUP_RUBRIC_TEXT = [
  "REFERENCE: how a follow-up call after a demo should go.",
  "",
  "By this call the owner has already seen the demo and agreed to try the service, usually a free trial with no payment up front. The call exists to get the agreement understood and signed, to get the trial set up, to keep the owner confident, and to make sure the trial will be judged on what matters to them. It is NOT a discovery call: do not mark the closer down for not asking about the cost of the problem or whether the owner can act, and do not score the NEPQ discovery stages.",
  "",
  "What strong looks like: the closer checks what the owner wants from the trial, goes through each part of the agreement in plain words and checks it is clear, answers any doubt with something concrete instead of reassurance, gets the signature while the owner is on the call, says exactly what happens next and who does what by when, spots anything that could stall the trial, and books the next call. What weak looks like: reading the agreement out without checking understanding, 'I hear you' to a doubt and moving on, leaving the owner unsure what happens next, saying things that weaken trust (complaining about our own tools, saying the closer is in another country to someone who just mentioned scams), and letting a reluctant owner drift into a trial nobody is checking on.",
].join("\n");
