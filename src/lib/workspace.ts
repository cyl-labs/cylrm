import {
  BarChart3,
  CalendarClock,
  Hash,
  Inbox,
  Kanban,
  MailOpen,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  ScrollText,
  Send,
  ShieldCheck,
  Table2,
  Receipt,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceId = "email" | "call";

export type WorkspaceLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type Workspace = {
  id: WorkspaceId;
  name: string;
  /** Letter shown in the switcher's badge. */
  initial: string;
  /** Where switching to this workspace lands you. */
  home: string;
  links: WorkspaceLink[];
};

/**
 * Email and calling are separate systems that share a login: no lead, list or
 * outcome crosses between them (see BLUEPRINT.md). They are therefore picked
 * from the workspace switcher rather than mixed into one sidebar, so each one
 * shows only its own screens.
 *
 * Which workspace you are in is read off the URL rather than stored, so a
 * deep link, the back button and the sidebar can never disagree about it.
 */
export const WORKSPACES: Workspace[] = [
  {
    id: "email",
    name: "Email CRM",
    initial: "E",
    home: "/leads",
    links: [
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/campaigns", label: "Campaigns", icon: Send },
      { href: "/accounts", label: "Accounts", icon: Inbox },
      { href: "/replies", label: "Replies", icon: MailOpen },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/stats", label: "Stats", icon: BarChart3 },
    ],
  },
  {
    id: "call",
    name: "Call CRM",
    initial: "C",
    home: "/calls",
    links: [
      // The first three are in the order a caller is required to work them —
      // see `lib/work-order.ts`, which refuses a lead queue until the two
      // above it are clear. The nav is where that order is learned, so it
      // reads top to bottom as the shift does; a sidebar listing them in a
      // different order to the one enforced would be teaching the wrong rule.
      { href: "/missed-calls", label: "Missed calls", icon: PhoneMissed },
      // Beside Missed calls because it is the same job from the other side: a
      // promise we made rather than one they did, worked the same way.
      { href: "/callbacks", label: "Callbacks", icon: PhoneForwarded },
      { href: "/calls", label: "Call lists", icon: PhoneCall },
      // Next to Callbacks because it is read the same way — a diary opened at
      // the start of a shift and worked top to bottom.
      { href: "/meetings", label: "Meetings", icon: CalendarClock },
      { href: "/sop", label: "Scripts", icon: ScrollText },
      { href: "/call-sheet", label: "Spreadsheet", icon: Table2 },
      { href: "/call-pipeline", label: "Pipeline", icon: Kanban },
      { href: "/scoreboard", label: "Scoreboard", icon: Trophy },
      { href: "/call-stats", label: "Stats", icon: BarChart3 },
      { href: "/keypad", label: "Keypad", icon: Hash },
      // Deliberately not "Accounts": that is the Gmail sending accounts on
      // the email side, and two screens with one name is how the wrong one
      // gets opened.
      { href: "/team", label: "Team", icon: ShieldCheck },
      { href: "/payroll", label: "Payroll", icon: Wallet },
      // Beside Payroll, which is the other half of the same question: that one
      // is what the people cost, this is what the phones do.
      { href: "/spend", label: "Spend", icon: Receipt },
    ],
  },
];

/**
 * Every path the Email CRM owns.
 *
 * Callers have no business on the email side — they were hired to dial, and
 * the sending accounts, campaign copy and reply inbox are not theirs to touch.
 * The middleware turns them away using this list and the switcher hides the
 * workspace, but the list is the single source for both so the two cannot
 * drift into a hidden-but-reachable screen.
 */
export const EMAIL_PREFIXES = [
  "/leads",
  "/campaigns",
  "/accounts",
  "/replies",
  "/pipeline",
  "/stats",
];

/**
 * Call CRM screens a caller may not open either.
 *
 * Team is who has a login and what they are paid to do, and Payroll is what
 * everyone is owed; both are the admins' business. Kept separate from
 * EMAIL_PREFIXES so the two reasons stay legible: one is a different product,
 * this is a permission.
 *
 * The Scoreboard joined them on 2026-09-03. It was the one performance screen a
 * caller could open, on the reasoning that a league table motivates a floor
 * without exposing staffing or wages. That holds for a floor; there is one
 * person dialling, and a leaderboard of one reads as a thin operation rather
 * than as a competition. Worth reopening to callers when there are enough of
 * them for it to be one — the screen itself is unchanged, only who may open it.
 *
 * `/call-stats` left this list on 2026-09-06 and is the odd one out: it is open
 * to everybody, but it is not one screen. An admin gets the floor's numbers; a
 * caller gets their own and nobody else's, because the page scopes every query
 * to them and drops the person picker and the By-person table. Closing it
 * entirely was costing the wrong thing — with the Scoreboard shut too, a caller
 * had no way to see their own day, hear a call back, or check a figure they are
 * paid on. **The scoping lives in the page**, so anything added to that screen
 * has to take `mine` into account or it will show a caller the floor.
 *
 * The Keypad was on this list until 2026-08-25. It is not a rank but a single
 * permission — `app_user.keypad_access`, granted per person — so it lives in
 * `KEYPAD_PREFIX` below instead. Admins keep it by being admins.
 */
export const ADMIN_ONLY_CALL_PREFIXES = [
  "/scoreboard",
  "/team",
  "/payroll",
  // The account balance and every line's usage — the same material Payroll is
  // closed for, and a screen where one caller can read another's minutes.
  "/spend",
];

/**
 * The Keypad, which is granted per person rather than by role.
 *
 * It dials a typed number and writes no `call` row, so nothing it dials
 * reaches Stats, the board or the Scoreboard. That is the reason it is granted
 * deliberately, and the reason the screen itself says so rather than relying
 * on whoever opened it to know.
 *
 * Checked against the database by the page and the nav rather than by the
 * middleware, which only has the session cookie: a cookie issued before a
 * grant says nothing about it, and the alternative was signing people out to
 * hand them a screen.
 */
export const KEYPAD_PREFIX = "/keypad";

export const isKeypadPath = (pathname: string) =>
  matches(pathname, [KEYPAD_PREFIX]);

/** `/stats` must not swallow `/call-stats`, hence startsWith on a path that
 *  begins with a slash rather than a bare contains. */
const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const isEmailPath = (pathname: string) => matches(pathname, EMAIL_PREFIXES);

/** Everything a caller is turned away from, in one test. */
export const isAdminOnlyPath = (pathname: string) =>
  matches(pathname, [...EMAIL_PREFIXES, ...ADMIN_ONLY_CALL_PREFIXES]);

/**
 * The nav for this person: a caller's Call CRM has no Scoreboard, Team or
 * Payroll in it, and the Keypad appears only for someone granted it.
 *
 * Stats is relabelled rather than hidden. The link goes to the same screen for
 * everybody, but what it opens is not the same thing — the floor's numbers for
 * an admin, this person's own for a caller — and "Stats" beside a Scoreboard
 * they cannot open would read as the floor's. The label is the one word that
 * says whose numbers are behind it before it is tapped.
 *
 * `keypad` is read from the database by the layout, not taken off the session,
 * so a grant made on the Team screen shows up on their next page load rather
 * than their next login. Hiding the link is the courtesy; the page is the
 * control.
 */
export function linksFor(
  workspace: Workspace,
  role: "admin" | "caller" | undefined,
  keypad = false,
) {
  const hidden = [
    ...(role === "admin" ? [] : ADMIN_ONLY_CALL_PREFIXES),
    ...(role === "admin" || keypad ? [] : [KEYPAD_PREFIX]),
  ];
  return workspace.links
    .filter((l) => !hidden.includes(l.href))
    .map((l) =>
      role !== "admin" && l.href === "/call-stats"
        ? { ...l, label: "My stats" }
        : l,
    );
}

/** The workspaces this person may switch to. A caller only has the one, and
 *  the switcher renders it as a plain label rather than a menu of one. */
export function workspacesFor(role: "admin" | "caller" | undefined) {
  return role === "admin" ? WORKSPACES : WORKSPACES.filter((w) => w.id === "call");
}

const CALL_PREFIXES = [
  "/calls",
  "/callbacks",
  "/missed-calls",
  "/meetings",
  "/sop",
  "/call-sheet",
  "/call-pipeline",
  "/scoreboard",
  "/call-stats",
  "/team",
  "/payroll",
  "/spend",
  "/keypad",
];

export function workspaceForPath(pathname: string): Workspace {
  const call = CALL_PREFIXES.some((p) => pathname.startsWith(p));
  return WORKSPACES[call ? 1 : 0];
}
