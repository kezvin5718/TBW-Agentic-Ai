/**
 * The 13 assignable Client Workflow sections. Used by the sidebar filter, the
 * middleware URL guard, and the Team & Access permission editor.
 * profiles.permissions: NULL = default employee access; string[] = ONLY these.
 *
 * `key`, `num` and `path` are load-bearing (grants in the database, the
 * middleware guard) and never change. `displayName` is the label the navigation
 * now uses for the same thing — display only, so the permission editor and the
 * menu call each tool by the same name.
 */
export const SECTIONS = [
  { key: "onboarding", num: 1, name: "Client Onboarding", displayName: "Client Onboarding", path: "/dashboard/onboarding" },
  { key: "brand-brain", num: 2, name: "Brand Brain", displayName: "Brand Brain", path: "/dashboard/brand-brain" },
  { key: "planning", num: 3, name: "Campaign Planning", displayName: "Campaign Planning", path: "/dashboard/planning" },
  { key: "approvals", num: 4, name: "Approvals Flow", displayName: "Campaign Approvals", path: "/dashboard/approvals" },
  // Section 5 was the unused Ad Production kanban; the slot (and its existing
  // permission grants — the key stays "production") now belongs to the Style
  // Library. Plan → Posts still lives under /dashboard/production/plan-posts,
  // guarded by the same key via SECTION_BY_PREFIX below.
  { key: "production", num: 5, name: "Style Library", displayName: "Style Library & Content Planner", path: "/dashboard/style-library" },
  { key: "image-studio", num: 6, name: "Image Studio", displayName: "Image Studio", path: "/dashboard/image-studio" },
  { key: "creatives-review", num: 7, name: "Creative Approvals", displayName: "Creative Approvals", path: "/dashboard/creatives-review" },
  { key: "content-hub", num: 8, name: "Content Hub", displayName: "Content Hub", path: "/dashboard/content-hub" },
  { key: "social-publisher", num: 9, name: "Social Publisher", displayName: "Social Publisher", path: "/dashboard/social-publisher" },
  { key: "publishing", num: 10, name: "Ad Publishing", displayName: "Ad Publishing", path: "/dashboard/publishing" },
  { key: "ads", num: 11, name: "Meta Ads Manager", displayName: "Meta Ads Manager", path: "/dashboard/ads" },
  { key: "reporting", num: 12, name: "Reporting & Analytics", displayName: "Insights & Reporting", path: "/dashboard/reporting" },
  { key: "agency-brain", num: 13, name: "Agency Brain", displayName: "Agency Brain", path: "/dashboard/agency-brain" },
  { key: "task-manager", num: 14, name: "Task Manager", displayName: "Task Manager", path: "/dashboard/task-manager" },
  { key: "ad-copy", num: 15, name: "Catalogue Ad Copy", displayName: "Catalogue Copy Studio", path: "/dashboard/ad-copy" },
  { key: "festivals", num: 16, name: "Festivals", displayName: "Festival & Moments Calendar", path: "/dashboard/festivals" },
  // These two were reachable by any employee no matter what their permission
  // list said: with no section registered, sectionKeyForPath returned null and
  // both the sidebar and the middleware fell back to a plain role check. A
  // founder could not revoke them because there was nothing to revoke.
  { key: "calls", num: 17, name: "Call Notes", displayName: "Call Notes", path: "/dashboard/calls" },
  { key: "connections", num: 18, name: "Agents Console", displayName: "Agent Console", path: "/dashboard/connections" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

// Path prefix → section key. The WhatsApp Task Bar now lives inside Task
// Manager as a tab, so its old standalone route follows the same permission.
export const SECTION_BY_PREFIX: Record<string, string> = {
  ...Object.fromEntries(SECTIONS.map((s) => [s.path, s.key])),
  "/dashboard/whatsapp-inbox": "task-manager",
  // 5b Plan → Posts (and the old kanban route) keep following section 5's grant.
  "/dashboard/production": "production",
};

export function sectionKeyForPath(path: string): string | null {
  const hit = Object.keys(SECTION_BY_PREFIX)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + "/"));
  return hit ? SECTION_BY_PREFIX[hit] : null;
}
