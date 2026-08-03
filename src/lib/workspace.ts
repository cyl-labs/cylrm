import {
  BarChart3,
  Inbox,
  Kanban,
  MailOpen,
  PhoneCall,
  Send,
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
      { href: "/call-sheet", label: "Spreadsheet", icon: Table2 },
      { href: "/call-pipeline", label: "Pipeline", icon: Kanban },
      { href: "/call-stats", label: "Stats", icon: BarChart3 },
    ],
  },
];

const CALL_PREFIXES = [
  "/calls",
  "/call-sheet",
  "/call-pipeline",
  "/call-stats",
];

export function workspaceForPath(pathname: string): Workspace {
  const call = CALL_PREFIXES.some((p) => pathname.startsWith(p));
  return WORKSPACES[call ? 1 : 0];
}
