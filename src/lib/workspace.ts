import {
  BarChart3,
  Hash,
  Inbox,
  Kanban,
  MailOpen,
  PhoneCall,
  PhoneForwarded,
  ScrollText,
  Send,
  ShieldCheck,
  Table2,
  Trophy,
  Users,
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
 * Stats is the whole operation's performance and Team is who has a login and
 * what they are paid to do; both are the admins' business. Callers get the
 * Scoreboard instead, which shows the floor's numbers without showing the
 * floor's staffing. Kept separate from EMAIL_PREFIXES so the two reasons stay
 * legible: one is a different product, this is a permission.
 *
 * Keypad is here for a third reason again: it places calls that no `call` row
 * records, so a caller working from it would be dialling off the books. Their
 * numbers are on niches assigned to them, where the outcome is logged.
 */
export const ADMIN_ONLY_CALL_PREFIXES = ["/call-stats", "/team", "/keypad"];

/** `/stats` must not swallow `/call-stats`, hence startsWith on a path that
 *  begins with a slash rather than a bare contains. */
const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const isEmailPath = (pathname: string) => matches(pathname, EMAIL_PREFIXES);

/** Everything a caller is turned away from, in one test. */
export const isAdminOnlyPath = (pathname: string) =>
  matches(pathname, [...EMAIL_PREFIXES, ...ADMIN_ONLY_CALL_PREFIXES]);

/** The nav for this person: a caller's Call CRM has no Stats in it. */
export function linksFor(
  workspace: Workspace,
  role: "admin" | "caller" | undefined,
) {
  if (role === "admin") return workspace.links;
  return workspace.links.filter((l) => !ADMIN_ONLY_CALL_PREFIXES.includes(l.href));
}

/** The workspaces this person may switch to. A caller only has the one, and
 *  the switcher renders it as a plain label rather than a menu of one. */
export function workspacesFor(role: "admin" | "caller" | undefined) {
  return role === "admin" ? WORKSPACES : WORKSPACES.filter((w) => w.id === "call");
}

const CALL_PREFIXES = [
  "/calls",
  "/callbacks",
  "/sop",
  "/call-sheet",
  "/call-pipeline",
  "/scoreboard",
  "/call-stats",
  "/team",
  "/keypad",
];

export function workspaceForPath(pathname: string): Workspace {
  const call = CALL_PREFIXES.some((p) => pathname.startsWith(p));
  return WORKSPACES[call ? 1 : 0];
}
