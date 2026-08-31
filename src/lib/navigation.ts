/**
 * The console's navigation, as data.
 *
 * One structure for everyone: the layout filters it by role and by the
 * employee permission list, and the sidebar renders whatever survives. Routes
 * are exactly the routes that already existed — this file renames labels and
 * regroups them by workstream, nothing else. Permission keys still come from
 * `sections.ts` via `sectionKeyForPath`; the grouping here plays no part in
 * who may see what.
 *
 * Icons travel as lucide names because a component function cannot cross into
 * the client sidebar; `SidebarNav`'s ICONS map turns them back into icons.
 */

export type NavRole = "founder" | "employee" | "client";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** lucide icon name — must exist in SidebarNav's ICONS map */
  icon: string;
  roles: NavRole[];
  /** extensible enum, not a free component: the sidebar decides how to draw it */
  badge?: "pendingSignups";
  /** sub-heading inside a section, e.g. "Approvals" — not a second collapse level */
  group?: string;
}

export interface NavSection {
  id: string;
  label: string;
  /** lucide icon name for the section header */
  icon: string;
  items: NavItem[];
}

const ALL: NavRole[] = ["founder", "employee", "client"];
const STAFF: NavRole[] = ["founder", "employee"];
const FOUNDER: NavRole[] = ["founder"];

export const NAVIGATION: NavSection[] = [
  {
    id: "home",
    label: "Home",
    icon: "Home",
    items: [
      { id: "command-centre", label: "Command Centre", href: "/dashboard", icon: "LayoutDashboard", roles: ALL },
    ],
  },
  {
    id: "clients-strategy",
    label: "Clients & Strategy",
    icon: "Compass",
    items: [
      { id: "onboarding", label: "Client Onboarding", href: "/dashboard/onboarding", icon: "UserPlus", roles: FOUNDER },
      { id: "brand-brain", label: "Brand Brain", href: "/dashboard/brand-brain", icon: "BrainCircuit", roles: ALL },
      { id: "planning", label: "Campaign Planning", href: "/dashboard/planning", icon: "ClipboardList", roles: STAFF },
    ],
  },
  {
    id: "work-approvals",
    label: "Work & Approvals",
    icon: "ClipboardCheck",
    items: [
      { id: "task-manager", label: "Task Manager", href: "/dashboard/task-manager", icon: "ListTodo", roles: STAFF },
      { id: "calls", label: "Call Notes", href: "/dashboard/calls", icon: "Phone", roles: FOUNDER },
      { id: "approvals", label: "Campaign Approvals", href: "/dashboard/approvals", icon: "CheckSquare", roles: STAFF, group: "Approvals" },
      { id: "creatives-review", label: "Creative Approvals", href: "/dashboard/creatives-review", icon: "Shield", roles: STAFF, group: "Approvals" },
    ],
  },
  {
    id: "creative-studio",
    label: "Creative Studio",
    icon: "Brush",
    items: [
      { id: "style-library", label: "Style Library", href: "/dashboard/style-library", icon: "Palette", roles: STAFF },
      { id: "image-studio", label: "Image Studio", href: "/dashboard/image-studio", icon: "Image", roles: STAFF },
      { id: "content-hub", label: "Content Hub", href: "/dashboard/content-hub", icon: "FolderUp", roles: STAFF },
    ],
  },
  {
    id: "social-content",
    label: "Social & Content",
    icon: "MessagesSquare",
    items: [
      { id: "plan-posts", label: "Content Planner", href: "/dashboard/production/plan-posts", icon: "Wand2", roles: STAFF },
      { id: "festivals", label: "Festival & Moments Calendar", href: "/dashboard/festivals", icon: "Sparkles", roles: STAFF },
      { id: "social-publisher", label: "Social Publisher", href: "/dashboard/social-publisher", icon: "Send", roles: STAFF },
    ],
  },
  {
    id: "paid-media",
    label: "Paid Media",
    icon: "Target",
    items: [
      { id: "publishing", label: "Ad Publishing", href: "/dashboard/publishing", icon: "UploadCloud", roles: STAFF },
      { id: "ads", label: "Meta Ads Manager", href: "/dashboard/ads", icon: "Megaphone", roles: STAFF },
      { id: "ad-copy", label: "Catalogue Copy Studio", href: "/dashboard/ad-copy", icon: "Sparkles", roles: STAFF },
    ],
  },
  {
    id: "insights",
    label: "Insights & Intelligence",
    icon: "BarChart3",
    items: [
      { id: "reporting", label: "Insights & Reporting", href: "/dashboard/reporting", icon: "LineChart", roles: ALL },
      { id: "agency-brain", label: "Agency Brain", href: "/dashboard/agency-brain", icon: "Layers", roles: FOUNDER },
    ],
  },
  {
    id: "ai-automation",
    label: "AI & Automation",
    icon: "Cpu",
    items: [
      { id: "jarvis", label: "Bron Assistant", href: "/dashboard/jarvis", icon: "Bot", roles: FOUNDER },
      { id: "whatsapp-reader", label: "WhatsApp Reader", href: "/dashboard/whatsapp-reader", icon: "Link2", roles: FOUNDER },
      { id: "connections", label: "Agent Console", href: "/dashboard/connections", icon: "Share2", roles: STAFF },
    ],
  },
  {
    id: "workspace-admin",
    label: "Workspace & Admin",
    icon: "SlidersHorizontal",
    items: [
      { id: "team", label: "Team & Access", href: "/dashboard/team", icon: "Users", roles: FOUNDER, badge: "pendingSignups" },
      { id: "integrations", label: "Integrations", href: "/dashboard/settings/integrations", icon: "Settings", roles: FOUNDER },
    ],
  },
  {
    id: "founder-finance",
    label: "Founder & Finance",
    icon: "Landmark",
    items: [
      { id: "accounting", label: "Accounting", href: "/dashboard/founder-zone/accounting", icon: "IndianRupee", roles: FOUNDER },
      { id: "credit-logs", label: "Credit Logs", href: "/dashboard/credit-logs", icon: "Wallet", roles: FOUNDER },
    ],
  },
];

/** localStorage key for the manually expanded/collapsed sections. */
export const NAV_OPEN_KEY = "tbw_nav_sections";
