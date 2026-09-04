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
      { href: "/calls", label: "Call lists", icon: PhoneCall },
      { href: "/callbacks", label: "Callbacks", icon: PhoneForwarded },
      // Beside Callbacks because it is the same job from the other side: a
      // promise they made rather than one we did, worked the same way.
      { href: "/missed-calls", label: "Missed calls", icon: PhoneMissed },
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
 * Stats is the whole operation's performance, Team is who has a login and what
 * they are paid to do, and Payroll is what everyone is owed; all of it is the
 * admins' business. Kept separate from EMAIL_PREFIXES so the two reasons stay
 * legible: one is a different product, this is a permission.
 *
 * The Scoreboard joined them on 2026-09-03. It was the one performance screen a
 * caller could open, on the reasoning that a league table motivates a floor
 * without exposing staffing or wages. That holds for a floor; there is one
 * person dialling, and a leaderboard of one reads as a thin operation rather
 * than as a competition. Worth reopening to callers when there are enough of
 * them for it to be one — the screen itself is unchanged, only who may open it.
 *
 * The Keypad was on this list until 2026-08-25. It is not a rank but a single
 * permission — `app_user.keypad_access`, granted per person — so it lives in
 * `KEYPAD_PREFIX` below instead. Admins keep it by being admins.
 */
export const ADMIN_ONLY_CALL_PREFIXES = [
  "/call-stats",
  "/scoreboard",
  "/team",
  "/payroll",
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
 * The nav for this person: a caller's Call CRM has no Stats or Scoreboard in
 * it, and the Keypad appears only for someone granted it.
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
  return workspace.links.filter((l) => !hidden.includes(l.href));
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
  "/keypad",
];

export function workspaceForPath(pathname: string): Workspace {
  const call = CALL_PREFIXES.some((p) => pathname.startsWith(p));
  return WORKSPACES[call ? 1 : 0];
}
