import type { EntityStats, StepStat, AccountStat } from "@/lib/stats";
import { notActiveReason } from "@/lib/campaign-progress";

// Static fixtures for demo mode ("Demo CRM" in the logo switcher). All ids
// live in the 9000+ range so they can never collide with real rows; write
// APIs are demo-guarded anyway. Dates are computed relative to now so the
// data always looks fresh.

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const FIRST = ["James", "Mary", "Wei", "Aisha", "Carlos", "Mei", "David", "Priya", "Ahmed", "Sarah", "Ben", "Nurul", "Marcus", "Li Xian", "Grace", "Hafiz", "Elena", "Jun Jie", "Farah", "Daniel"];
const LAST = ["Tan", "Ivanova", "Sato", "Wong", "Novak", "Smith", "Ong", "Patel", "Chen", "Lim", "Koh", "Rahman", "Lee", "Goh", "Teo", "Ismail", "Petrova", "Ng", "Aziz", "Chua"];
const COMPANIES = ["Acme Steel", "MetalCraft Pte Ltd", "SteelFlow Asia", "Alloy Partners", "Ironworks SG", "Precision Metals", "Forge Dynamics", "BuildRight Fabrication", "TitanWorks", "Smith & Sons", "Jurong Precision", "Straits Logistics", "Harbour Freight MY", "Meridian Brokers", "Northport Cargo"];
const TITLES = ["Owner", "General Manager", "Operations Manager", "Sales Director", "Plant Manager", "Managing Director", "Procurement Lead"];

export const demoLeadLists = [
  { id: 9001, name: "Steel fabricators SG — Jul", niche: "steel fabricators" },
  { id: 9002, name: "Logistics brokers MY — Jun", niche: "logistics" },
  { id: 9003, name: "Precision machining SG — May", niche: "machining" },
];

export function demoContacts() {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const company = COMPANIES[(i * 3) % COMPANIES.length];
    const list = demoLeadLists[i % 3];
    rows.push({
      id: 9100 + i,
      email: `${first.toLowerCase().replace(/\s/g, ".")}.${last.toLowerCase().replace(/\s/g, "")}${i}@${company.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      firstName: first,
      lastName: last,
      company,
      title: TITLES[(i * 5) % TITLES.length],
      leadListId: list.id,
      leadListName: list.name,
      duplicateOfContactId: i % 11 === 10 ? 9100 + (i % 9) : null,
      importedAt: ago(3 + (i % 3) * 22).toISOString(),
    });
  }
  return rows;
}

export const demoDomains = [
  { id: 9001, name: "outreachmail.co" },
  { id: 9002, name: "cylermail.com" },
];

export function demoAccounts() {
  return [
    { id: 9001, email: "sara@outreachmail.co", senderName: "Sara Lim", active: true, dailyCap: 50, domainId: 9001, domainName: "outreachmail.co", hasGoogle: true, needsReconnect: false, googleConnectedAt: ago(1).toISOString(), hasAppPassword: true, sentToday: 14, sentTotal: 1240, bounceTotal: 11 },
    { id: 9002, email: "ben@outreachmail.co", senderName: "Ben Ortiz", active: true, dailyCap: 50, domainId: 9001, domainName: "outreachmail.co", hasGoogle: true, needsReconnect: false, googleConnectedAt: ago(5.4).toISOString(), hasAppPassword: true, sentToday: 18, sentTotal: 1516, bounceTotal: 19 },
    { id: 9003, email: "ops@outreachmail.co", senderName: "Ops Inbox", active: false, dailyCap: 15, domainId: 9001, domainName: "outreachmail.co", hasGoogle: false, needsReconnect: false, googleConnectedAt: null, hasAppPassword: true, sentToday: 0, sentTotal: 388, bounceTotal: 4 },
    { id: 9004, email: "mei@cylermail.com", senderName: "Mei Tan", active: true, dailyCap: 40, domainId: 9002, domainName: "cylermail.com", hasGoogle: true, needsReconnect: false, googleConnectedAt: ago(0.2).toISOString(), hasAppPassword: true, sentToday: 9, sentTotal: 2044, bounceTotal: 12 },
    { id: 9005, email: "dev@cylermail.com", senderName: "Dev Rao", active: true, dailyCap: 40, domainId: 9002, domainName: "cylermail.com", hasGoogle: true, needsReconnect: true, googleConnectedAt: ago(9).toISOString(), hasAppPassword: true, sentToday: 11, sentTotal: 1873, bounceTotal: 58 },
  ];
}

export const demoSetting = {
  sendingWindowStart: "09:00",
  sendingWindowEnd: "17:30",
  sendingTimezone: "Asia/Singapore",
  sendWeekdaysOnly: true,
};

// totalCount is enrollments, not sent messages: each enrollment receives
// between 1 and stepCount emails, so 288 enrollments produce the 486 sends the
// Stats fixtures report. The per-status and per-step split lives in
// CAMPAIGN_ENROLLMENTS below, and every count on the campaign detail screen is
// derived from it so the two screens cannot drift.
export function demoCampaigns() {
  return [
    { id: 9001, name: "Steel fabricators — pain-point pitch", status: "active" as const, createdAt: ago(24), stepCount: 3, activeCount: 121, totalCount: 288 },
    { id: 9002, name: "Logistics brokers — case study angle", status: "active" as const, createdAt: ago(18), stepCount: 2, activeCount: 84, totalCount: 222 },
    { id: 9003, name: "Machining — reactivation", status: "paused" as const, createdAt: ago(51), stepCount: 1, activeCount: 0, totalCount: 164 },
  ];
}

/** Per-campaign enrollment mix: status, how many steps that group has already
 * received, and how far ahead its next send sits (null = terminal, nothing
 * scheduled). Σ(step × count) equals the campaign's sent total in the Stats
 * fixtures — 486 / 305 / 164. */
type EnrollSpec = {
  status: string;
  step: number;
  count: number;
  /** Days ahead the next send is spread over; null for terminal statuses. */
  nextIn: number | null;
};

const CAMPAIGN_ENROLLMENTS: Record<number, EnrollSpec[]> = {
  9001: [
    { status: "active", step: 0, count: 64, nextIn: 2 },
    { status: "active", step: 1, count: 27, nextIn: 3 },
    { status: "active", step: 2, count: 30, nextIn: 4 },
    { status: "completed", step: 3, count: 100, nextIn: null },
    { status: "replied", step: 1, count: 21, nextIn: null },
    { status: "replied", step: 2, count: 20, nextIn: null },
    { status: "bounced", step: 1, count: 7, nextIn: null },
    { status: "ooo_paused", step: 2, count: 12, nextIn: 7 },
    { status: "failed", step: 1, count: 2, nextIn: null },
    { status: "unsubscribed", step: 1, count: 5, nextIn: null },
  ],
  9002: [
    { status: "active", step: 0, count: 26, nextIn: 2 },
    { status: "active", step: 1, count: 58, nextIn: 3 },
    { status: "completed", step: 2, count: 100, nextIn: null },
    { status: "replied", step: 1, count: 10, nextIn: null },
    { status: "replied", step: 2, count: 9, nextIn: null },
    { status: "bounced", step: 1, count: 9, nextIn: null },
    { status: "ooo_paused", step: 1, count: 6, nextIn: 7 },
    { status: "failed", step: 1, count: 1, nextIn: null },
    { status: "unsubscribed", step: 1, count: 3, nextIn: null },
  ],
  9003: [
    { status: "completed", step: 1, count: 150, nextIn: null },
    { status: "replied", step: 1, count: 8, nextIn: null },
    { status: "bounced", step: 1, count: 2, nextIn: null },
    { status: "ooo_paused", step: 1, count: 3, nextIn: 0 },
    { status: "unsubscribed", step: 1, count: 1, nextIn: null },
  ],
};

const eligibleDemoAccounts = () =>
  demoAccounts().filter((a) => a.active && a.hasGoogle && !a.needsReconnect);

export function demoCampaignEnrollments(id: number) {
  const specs = CAMPAIGN_ENROLLMENTS[id];
  if (!specs) return [];
  const contacts = demoContacts();
  const accounts = eligibleDemoAccounts();
  const now = Date.now();
  const rows = [];
  let n = 0;
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      const c = contacts[(n * 13 + 5) % contacts.length];
      // Spread the group across its window, with the first of every five
      // already overdue so the "due now" tile is never empty.
      const offsetDays =
        spec.nextIn === null ? 0 : ((i % 5) / 4) * spec.nextIn - 0.1;
      const nextSendAt =
        spec.nextIn === null ? null : new Date(now + offsetDays * DAY);
      rows.push({
        id: 9300 + n,
        contactName: `${c.firstName} ${c.lastName}`,
        contactEmail: c.email,
        company: c.company,
        currentStep: spec.step,
        status: spec.status,
        accountEmail:
          spec.step === 0 ? null : accounts[n % accounts.length].email,
        nextSendAt: nextSendAt?.toISOString() ?? null,
        due:
          spec.status === "active" &&
          nextSendAt !== null &&
          nextSendAt.getTime() <= now,
      });
      n++;
    }
  }
  // Soonest first, matching the real query's ordering.
  return rows.sort((a, b) => {
    if (a.nextSendAt === null) return b.nextSendAt === null ? 0 : 1;
    if (b.nextSendAt === null) return -1;
    return a.nextSendAt.localeCompare(b.nextSendAt);
  });
}

export function demoCampaignDetail(id: number) {
  const campaign = demoCampaigns().find((c) => c.id === id);
  if (!campaign) return null;
  const steps = [
    { id: 9101, variant: "a" as const, label: null, stepNumber: 1, waitDaysAfterPrevious: 0, subjectTemplate: "Quick question, {{first_name}}", bodyTemplate: "Hi {{first_name}},\n\nSaw {{company}} while researching fabricators in SG — most teams your size tell us quoting eats 2–3 hours a day.\n\nWorth a 15-minute look at how we cut that to minutes?" },
    { id: 9102, variant: "a" as const, label: null, stepNumber: 2, waitDaysAfterPrevious: 3, subjectTemplate: null, bodyTemplate: "Bumping this, {{first_name}} — happy to send the 2-page case study instead if a call is too much right now." },
    { id: 9103, variant: "a" as const, label: null, stepNumber: 3, waitDaysAfterPrevious: 4, subjectTemplate: null, bodyTemplate: "Last nudge, {{first_name}} — if quoting speed isn't a priority this quarter, no worries at all. Door's open." },
  ].slice(0, campaign.stepCount);
  const countByStatus = new Map<string, number>();
  for (const spec of CAMPAIGN_ENROLLMENTS[id] ?? []) {
    countByStatus.set(spec.status, (countByStatus.get(spec.status) ?? 0) + spec.count);
  }
  return { campaign, steps, countByStatus };
}

/** Demo twin of `getCampaignProgress`, derived from the same fixtures so the
 * tiles, the enrollment table, and the Stats screen all agree. */
export function demoCampaignProgress(id: number) {
  const campaign = demoCampaigns().find((c) => c.id === id);
  const specs = CAMPAIGN_ENROLLMENTS[id];
  if (!campaign || !specs) return null;
  const detail = demoCampaignDetail(id)!;
  const stepCount = campaign.stepCount;

  const totalFor = (s: EnrollSpec[]) =>
    s.reduce((acc, x) => acc + Math.max(stepCount - x.step, 0) * x.count, 0);
  const active = specs.filter((s) => s.status === "active");
  const remaining = totalFor(active);
  const notStarted = active
    .filter((s) => s.step === 0)
    .reduce((acc, s) => acc + s.count, 0);
  const sent = specs.reduce((acc, s) => acc + s.step * s.count, 0);
  const sum = (s: EnrollSpec[]) => s.reduce((acc, x) => acc + x.count, 0);
  const contactsEnrolled = sum(specs);
  const contactsMessaged = sum(specs.filter((s) => s.step > 0));
  const secondTouchesLeft =
    stepCount >= 2 ? sum(active.filter((s) => s.step < 2)) : 0;

  // Other active campaigns share the same account pool.
  const activeIds = demoCampaigns()
    .filter((c) => c.status === "active")
    .map((c) => c.id);
  let globalRemaining = 0;
  let globalNotStarted = 0;
  for (const cid of activeIds) {
    const c = demoCampaigns().find((x) => x.id === cid)!;
    for (const s of CAMPAIGN_ENROLLMENTS[cid] ?? []) {
      if (s.status !== "active") continue;
      globalRemaining += Math.max(c.stepCount - s.step, 0) * s.count;
      if (s.step === 0) globalNotStarted += s.count;
    }
  }

  const accounts = eligibleDemoAccounts();
  const [sh, sm] = demoSetting.sendingWindowStart.split(":").map(Number);
  const [eh, em] = demoSetting.sendingWindowEnd.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: demoSetting.sendingTimezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const nowMin = (get("hour") % 24) * 60 + get("minute");
  const open = nowMin >= startMin && nowMin < endMin;
  const minutesRemaining = open ? endMin - nowMin : 0;
  const ticksPerDay = Math.floor((endMin - startMin) / 5);
  const ticksLeftToday = Math.floor(minutesRemaining / 5);

  const capacityPerDay = accounts.reduce(
    (acc, a) => acc + Math.min(a.dailyCap, ticksPerDay),
    0,
  );
  const capacityLeftToday = accounts.reduce(
    (acc, a) => acc + Math.max(0, Math.min(a.dailyCap - a.sentToday, ticksLeftToday)),
    0,
  );
  // Today's sends split across the two running campaigns.
  const sentToday = id === 9001 ? 28 : id === 9002 ? 13 : 0;

  const fullSequenceDays = detail.steps
    .filter((s) => s.stepNumber >= 2)
    .reduce((acc, s) => acc + s.waitDaysAfterPrevious, 0);

  const blockedReason =
    remaining === 0
      ? null
      : campaign.status !== "active"
        ? notActiveReason(campaign.status)
        : null;

  let etaDays: number | null = null;
  if (remaining > 0 && blockedReason === null && capacityPerDay > 0) {
    const capacityDays = Math.ceil(globalRemaining / capacityPerDay);
    const tailDays =
      notStarted > 0
        ? Math.ceil(globalNotStarted / capacityPerDay) + fullSequenceDays
        : 0;
    // Longest tail already in flight: time to its next send plus later waits.
    const inFlight = Math.max(
      0,
      ...active
        .filter((s) => s.step >= 1)
        .map(
          (s) =>
            (s.nextIn ?? 0) +
            detail.steps
              .filter((x) => x.stepNumber >= s.step + 2)
              .reduce((acc, x) => acc + x.waitDaysAfterPrevious, 0),
        ),
    );
    etaDays = Math.max(capacityDays, tailDays, Math.ceil(inFlight));
  }

  const rows = demoCampaignEnrollments(id);
  const total = sent + remaining;

  return {
    campaignStatus: campaign.status,
    stepCount,
    sent,
    sentToday,
    remaining,
    notStarted,
    contactsMessaged,
    contactsEnrolled,
    secondTouchesLeft,
    dueNow: rows.filter((r) => r.due).length,
    oooPaused: detail.countByStatus.get("ooo_paused") ?? 0,
    percentComplete: total === 0 ? 0 : Math.round((sent / total) * 100),
    capacityPerDay,
    capacityLeftToday,
    eligibleAccounts: accounts.length,
    activeCampaigns: activeIds.length,
    globalRemaining,
    etaDays,
    etaDate:
      etaDays === null
        ? null
        : new Date(Date.now() + etaDays * DAY).toISOString(),
    window: {
      start: demoSetting.sendingWindowStart,
      end: demoSetting.sendingWindowEnd,
      timezone: demoSetting.sendingTimezone,
      open,
      minutesRemaining,
      weekdaysOnly: demoSetting.sendWeekdaysOnly,
    },
    blockedReason,
  };
}

const DEAL_STAGES = ["replied", "interested", "demo_booked", "won", "lost"] as const;

export function demoDeals() {
  // One coherent story shared with the Stats fixtures: 955 sent, 68 human
  // replies (one deal each), 17 demos booked (6 still there + 6 won + 5 of
  // the lost), 6 won. Board columns therefore hold 30/15/6/6/11 deals.
  const spread = [30, 15, 6, 6, 11];
  const contacts = demoContacts();
  const campaigns = demoCampaigns();
  const deals: {
    id: number;
    stage: (typeof DEAL_STAGES)[number];
    contactName: string;
    contactEmail: string;
    company: string | null;
    campaignName: string;
    stageSince: string;
  }[] = [];
  let n = 0;
  DEAL_STAGES.forEach((stage, si) => {
    for (let i = 0; i < spread[si]; i++) {
      const c = contacts[(n * 7 + 3) % contacts.length];
      // Campaign mix ~60/30/10, matching the per-campaign reply counts.
      const campaign = campaigns[n % 10 < 6 ? 0 : n % 10 < 9 ? 1 : 2];
      deals.push({
        id: 9200 + n,
        stage,
        contactName: `${c.firstName} ${c.lastName}`,
        contactEmail: c.email,
        company: c.company,
        campaignName: campaign.name,
        stageSince: ago(si === 0 ? 1 + (i % 12) : 2 + (i % 14) * 2 + si).toISOString(),
      });
      n++;
    }
  });
  return deals;
}

// Totals match the Stats demo fixtures (486+305+164 sent, 41+19+8 replies,
// 11+4+2 demos, 4+1+1 won) and reconcile with the board spread above.
export const demoPipelineTiles = { sent: 955, replies: 68, demos: 17, won: 6 };

export function demoThread(dealId: number) {
  const deal = demoDeals().find((d) => d.id === dealId);
  if (!deal) return null;
  const first = deal.contactName.split(" ")[0];
  return {
    deal: { id: deal.id, stage: deal.stage },
    contact: { id: 1, email: deal.contactEmail, name: deal.contactName, company: deal.company },
    campaign: { id: 9001, name: deal.campaignName },
    enrollment: { id: 1, status: "replied" },
    unsubscribed: false,
    messages: [
      { id: 1, direction: "out", kind: "sent", stepNumber: 1, subject: `Quick question, ${first}`, bodyText: `Hi ${first},\n\nSaw ${deal.company} while researching the space — most teams your size tell us quoting eats 2–3 hours a day.\n\nWorth a 15-minute look?`, sentAt: ago(6).toISOString(), accountEmail: "sara@outreachmail.co" },
      { id: 2, direction: "out", kind: "sent", stepNumber: 2, subject: `Re: Quick question, ${first}`, bodyText: `Bumping this, ${first} — happy to send the 2-page case study instead.`, sentAt: ago(3).toISOString(), accountEmail: "sara@outreachmail.co" },
      { id: 3, direction: "in", kind: "reply", stepNumber: null, subject: `Re: Quick question, ${first}`, bodyText: "Interesting timing actually — we're reviewing tooling this quarter. Send the case study and some times for next week?", sentAt: ago(2.5).toISOString(), accountEmail: "sara@outreachmail.co" },
    ],
  };
}

export function demoEntityStats(by: "campaign" | "leadlist"): Map<number, EntityStats> {
  const rows: EntityStats[] =
    by === "campaign"
      ? [
          { id: 9001, sent: 486, bounces: 7, replies: 41, ooo: 12, completion: 188, deals: 41, positive: 22, demos: 11, won: 4, avgSecondsToDemo: 2.1 * 86400 },
          { id: 9002, sent: 305, bounces: 9, replies: 19, ooo: 6, completion: 121, deals: 19, positive: 9, demos: 4, won: 1, avgSecondsToDemo: 3.4 * 86400 },
          { id: 9003, sent: 164, bounces: 2, replies: 8, ooo: 3, completion: 88, deals: 8, positive: 4, demos: 2, won: 1, avgSecondsToDemo: 5.0 * 86400 },
        ]
      : [
          { id: 9001, sent: 418, bounces: 6, replies: 36, ooo: 10, completion: 160, deals: 36, positive: 19, demos: 10, won: 4, avgSecondsToDemo: 2.3 * 86400 },
          { id: 9002, sent: 305, bounces: 9, replies: 19, ooo: 6, completion: 121, deals: 19, positive: 9, demos: 4, won: 1, avgSecondsToDemo: 3.4 * 86400 },
          { id: 9003, sent: 232, bounces: 3, replies: 13, ooo: 4, completion: 116, deals: 13, positive: 7, demos: 3, won: 1, avgSecondsToDemo: 4.1 * 86400 },
        ];
  return new Map(rows.map((r) => [r.id, r]));
}

export const demoStepStats: StepStat[] = [
  { campaignId: 9001, step: 1, sent: 486, replies: 24 },
  { campaignId: 9001, step: 2, sent: 402, replies: 11 },
  { campaignId: 9001, step: 3, sent: 310, replies: 6 },
  { campaignId: 9002, step: 1, sent: 305, replies: 12 },
  { campaignId: 9002, step: 2, sent: 246, replies: 7 },
  { campaignId: 9003, step: 1, sent: 164, replies: 8 },
];

export const demoAccountStats: AccountStat[] = [
  { accountId: 9001, email: "sara@outreachmail.co", domain: "outreachmail.co", sent: 512, bounces: 6, replies: 31 },
  { accountId: 9002, email: "ben@outreachmail.co", domain: "outreachmail.co", sent: 498, bounces: 7, replies: 24 },
  { accountId: 9004, email: "mei@cylermail.com", domain: "cylermail.com", sent: 402, bounces: 4, replies: 18 },
  { accountId: 9005, email: "dev@cylermail.com", domain: "cylermail.com", sent: 388, bounces: 12, replies: 9 },
];

/* ---------------------------------------------------------------- *
 * Call CRM
 *
 * The calling side gets its own fixtures rather than borrowing the
 * email ones — the two systems share no tables, and a demo that
 * blurred that would misrepresent the product. Ids stay in the 9000+
 * range for the same reason as everything above.
 * ---------------------------------------------------------------- */

const CALL_COMPANIES = [
  "Coolbreeze Aircon Servicing", "Rahman Aircon & Engineering", "Arctic Air Services",
  "CoolTech Maintenance", "Island Breeze Engineering", "Chua Brothers Aircon",
  "Frostline Cooling Systems", "Aziz Aircon Solutions", "Kohs Cooling Specialists",
  "Breezeway Servicing", "Southpoint Aircon", "Teo Aircon Engineering",
  "Zenith Air Conditioning", "Evergreen Climate Control", "Chia Cooling Works",
  "Marina Cool Services", "Bedok Air Systems", "Tampines Climate Care",
];

const CALL_OUTCOMES = [
  "no_answer", "voicemail", "gatekeeper", "callback",
  "not_interested", "demo_booked", "trial", "won", "lost", "bad_number",
] as const;

/** Deterministic pseudo-random so the demo looks identical on every render. */
const spread = (i: number, n: number) => (i * 7 + 3) % n;

export const demoCallLists = [
  { id: 9501, name: "Aircon servicing SG — Aug", niche: "aircon servicing" },
  { id: 9502, name: "Renovation contractors SG — Jul", niche: "renovation" },
];

function demoCallLeads(listId: number) {
  const count = listId === 9501 ? 18 : 11;
  const rows = [];
  for (let i = 0; i < count; i++) {
    // Stride must be coprime with the array length or it revisits a fraction
    // of it — i*3 over 18 companies only ever reached six of them, so the
    // demo queue showed the same business several times over.
    const company = CALL_COMPANIES[(i * 5 + listId) % CALL_COMPANIES.length];
    // Roughly a third never tried, a third mid-flow, a third closed out.
    const phase = spread(i, 9);
    const outcome = phase < 3 ? null : CALL_OUTCOMES[spread(i, CALL_OUTCOMES.length)];
    const attempts = outcome === null ? 0 : 1 + spread(i, 3);
    rows.push({
      // Ids have to be unique across lists, not just within one: the
      // spreadsheet puts every list in a single grid, and the old
      // `9600 + listId * 10 + i` gave the eleventh lead of one list the same
      // id as the first lead of the next.
      id: listId * 1000 + i,
      phone: `+65 6${String(200 + spread(i, 700)).padStart(3, "0")} ${String(1000 + spread(i * 13, 8999)).padStart(4, "0")}`,
      name: `${FIRST[(i * 5) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
      company,
      title: TITLES[(i * 2) % TITLES.length],
      email: null,
      attempts,
      lastOutcome: outcome,
      lastCalledAt: outcome === null ? null : ago(spread(i, 6)).toISOString(),
      callbackAt:
        outcome === "callback" ? new Date(Date.now() - DAY / 2).toISOString() : null,
      lastNotes:
        outcome === "gatekeeper"
          ? "Receptionist took a message, owner back Tuesday."
          : outcome === "callback"
            ? "Asked to try again after lunch."
            : null,
    });
  }
  return rows;
}

const TERMINAL_DEMO = [
  "not_interested",
  "demo_booked",
  "trial",
  "won",
  "lost",
  "bad_number",
];

export function demoCallListSummaries() {
  return demoCallLists.map((l) => {
    const leads = demoCallLeads(l.id);
    const by = (fn: (o: string | null) => boolean) =>
      leads.filter((x) => fn(x.lastOutcome)).length;
    return {
      ...l,
      createdAt: ago(l.id === 9501 ? 4 : 26).toISOString(),
      total: leads.length,
      uncalled: by((o) => o === null),
      calledToday: leads.filter((x) => x.lastOutcome !== null).length,
      conversationsToday: by((o) =>
        [
          "gatekeeper",
          "callback",
          "not_interested",
          "demo_booked",
          "trial",
          "won",
          "lost",
        ].includes(o ?? ""),
      ),
      noAnswerToday: by((o) => ["no_answer", "voicemail"].includes(o ?? "")),
      badNumbersToday: by((o) => o === "bad_number"),
      toRetry: by((o) => o !== null && ["no_answer", "voicemail", "gatekeeper"].includes(o)),
      ruledOut: by((o) => o !== null && ["not_interested", "bad_number", "lost"].includes(o)),
      demoBooked: by((o) => o === "demo_booked"),
      trials: by((o) => o === "trial"),
      won: by((o) => o === "won"),
      // The demo's callbacks are all in the past, so all of them are due.
      callbacksDue: by((o) => o === "callback"),
      callbacksLater: 0,
      duplicates: 0,
    };
  });
}

export function demoCallListDetail(id: number) {
  return demoCallListSummaries().find((l) => l.id === id) ?? null;
}

/** Every demo lead as spreadsheet rows: most recently called first, then the
 *  never-called by list and company — the order the real sheet uses. */
export function demoSheetLeads() {
  const rows = demoCallLists
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((list) =>
      demoCallLeads(list.id)
        .map((l) => ({ ...l, listId: list.id, listName: list.name }))
        .sort((a, b) =>
          (a.company || a.name || a.phone).localeCompare(
            b.company || b.name || b.phone,
          ),
        ),
    );
  return rows.sort((a, b) => {
    if (a.lastCalledAt === b.lastCalledAt) return 0;
    if (a.lastCalledAt === null) return 1;
    if (b.lastCalledAt === null) return -1;
    return b.lastCalledAt.localeCompare(a.lastCalledAt);
  });
}

/** The demo board: the same rows as the sheet, staged — exactly what
 *  `getCallBoard` returns. */
export function demoCallBoard(listId?: number) {
  const stageFor = (o: string | null) => {
    if (o === null) return "to_call" as const;
    if (o === "callback") return "callback" as const;
    if (o === "demo_booked") return "demo_booked" as const;
    if (o === "trial") return "trial" as const;
    if (o === "won") return "won" as const;
    if (o === "lost" || o === "not_interested" || o === "bad_number") {
      return "lost" as const;
    }
    return "tried" as const;
  };
  const all = demoSheetLeads()
    .filter((l) => listId === undefined || l.listId === listId)
    .map((l) => ({ ...l, stage: stageFor(l.lastOutcome) }));
  return all;
}

/** Demo stats, computed from the same fixtures rather than made up, so the
 *  numbers on the screen add up to the rows behind them. */
export function demoCallStats(listId?: number) {
  const leads = demoSheetLeads().filter(
    (l) => listId === undefined || l.listId === listId,
  );
  const called = leads.filter((l) => l.lastOutcome !== null);
  const PICKUP = [
    "gatekeeper",
    "callback",
    "not_interested",
    "demo_booked",
    "trial",
    "won",
    "lost",
  ];
  const by = (o: string) => called.filter((l) => l.lastOutcome === o).length;
  const calls = called.reduce((sum, l) => sum + l.attempts, 0);
  const pickups = called.filter((l) => PICKUP.includes(l.lastOutcome!)).length;

  const outcomes = (
    [
      "no_answer",
      "voicemail",
      "gatekeeper",
      "callback",
      "not_interested",
      "demo_booked",
      "trial",
      "won",
      "lost",
      "bad_number",
    ] as const
  )
    .map((outcome) => ({ outcome, calls: by(outcome) }))
    .filter((o) => o.calls > 0)
    .sort((a, b) => b.calls - a.calls);

  const shownLists = demoCallLists.filter(
    (list) => listId === undefined || list.id === listId,
  );
  const lists = shownLists.map((list) => {
    const mine = leads.filter((l) => l.listId === list.id);
    const worked = mine.filter((l) => l.lastOutcome !== null);
    return {
      id: list.id,
      name: list.name,
      leads: mine.length,
      worked: worked.length,
      calls: worked.reduce((sum, l) => sum + l.attempts, 0),
      pickups: worked.filter((l) => PICKUP.includes(l.lastOutcome!)).length,
      demos: worked.filter((l) => l.lastOutcome === "demo_booked").length,
      trials: worked.filter((l) => l.lastOutcome === "trial").length,
      won: worked.filter((l) => l.lastOutcome === "won").length,
    };
  });

  // Deterministic, like the rest of the demo: the same fortnight every render.
  const byDay = Array.from({ length: 14 }, (_, i) => {
    const d = ago(13 - i);
    const n = spread(i, 7) * 3 + 2;
    return {
      day: d.toISOString().slice(0, 10),
      calls: n,
      pickups: Math.round(n * 0.4),
    };
  });

  return {
    totals: {
      calls,
      leadsDialled: called.length,
      pickups,
      demos: by("demo_booked"),
      trials: by("trial"),
      won: by("won"),
      lost: by("lost"),
      badNumbers: by("bad_number"),
    },
    outcomes,
    lists,
    byDay,
  };
}

/** The demo diary: the sheet's callbacks, soonest first — what `getCallbacks`
 *  returns. */
export function demoCallbacks(listId?: number) {
  return demoSheetLeads()
    .filter(
      (l) =>
        l.lastOutcome === "callback" &&
        (listId === undefined || l.listId === listId),
    )
    .sort(
      (a, b) =>
        new Date(a.callbackAt ?? 0).getTime() -
        new Date(b.callbackAt ?? 0).getTime(),
    )
    .map((l) => ({
      ...l,
      due: l.callbackAt !== null && new Date(l.callbackAt) <= new Date(),
    }));
}

export function demoCallQueue(id: number, filter: string) {
  const leads = demoCallLeads(id);
  if (filter === "callbacks") {
    return leads.filter((l) => l.lastOutcome === "callback");
  }
  if (filter === "closed") {
    return leads.filter(
      (l) => l.lastOutcome !== null && TERMINAL_DEMO.includes(l.lastOutcome),
    );
  }
  if (filter === "all") return leads;
  // Mirrors the real queue: a callback is only in it once its time has come.
  return leads.filter(
    (l) =>
      l.lastOutcome === null ||
      (!TERMINAL_DEMO.includes(l.lastOutcome) &&
        (l.lastOutcome !== "callback" ||
          l.callbackAt === null ||
          new Date(l.callbackAt) <= new Date())),
  );
}
