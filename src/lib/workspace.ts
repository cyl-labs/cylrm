import {
  BarChart3,
  Inbox,
  Kanban,
  MailOpen,
  PhoneCall,
  PhoneForwarded,
  Send,
  ShieldCheck,
  Table2,
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
      { href: "/call-sheet", label: "Spreadsheet", icon: Table2 },
      { href: "/call-pipeline", label: "Pipeline", icon: Kanban },
      { href: "/call-stats", label: "Stats", icon: BarChart3 },
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

/** `/stats` must not swallow `/call-stats`, hence startsWith on a path that
 *  begins with a slash rather than a bare contains. */
export const isEmailPath = (pathname: string) =>
  EMAIL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** The workspaces this person may switch to. A caller only has the one, and
 *  the switcher renders it as a plain label rather than a menu of one. */
export function workspacesFor(role: "admin" | "caller" | undefined) {
  return role === "admin" ? WORKSPACES : WORKSPACES.filter((w) => w.id === "call");
}

const CALL_PREFIXES = [
  "/calls",
  "/callbacks",
  "/call-sheet",
  "/call-pipeline",
  "/call-stats",
  "/team",
];

export function workspaceForPath(pathname: string): Workspace {
  const call = CALL_PREFIXES.some((p) => pathname.startsWith(p));
  return WORKSPACES[call ? 1 : 0];
}
