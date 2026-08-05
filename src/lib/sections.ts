/**
 * The 13 assignable Client Workflow sections. Used by the sidebar filter, the
 * middleware URL guard, and the Team & Access permission editor.
 * profiles.permissions: NULL = default employee access; string[] = ONLY these.
 */
export const SECTIONS = [
  { key: "onboarding", num: 1, name: "Client Onboarding", path: "/dashboard/onboarding" },
  { key: "brand-brain", num: 2, name: "Brand Brain", path: "/dashboard/brand-brain" },
  { key: "planning", num: 3, name: "Campaign Planning", path: "/dashboard/planning" },
  { key: "approvals", num: 4, name: "Approvals Flow", path: "/dashboard/approvals" },
  { key: "production", num: 5, name: "Ad Production", path: "/dashboard/production" },
  { key: "image-studio", num: 6, name: "Image Studio", path: "/dashboard/image-studio" },
  { key: "creatives-review", num: 7, name: "Creative Approvals", path: "/dashboard/creatives-review" },
  { key: "content-hub", num: 8, name: "Content Hub", path: "/dashboard/content-hub" },
  { key: "social-publisher", num: 9, name: "Social Publisher", path: "/dashboard/social-publisher" },
  { key: "publishing", num: 10, name: "Ad Publishing", path: "/dashboard/publishing" },
  { key: "ads", num: 11, name: "Meta Ads Manager", path: "/dashboard/ads" },
  { key: "reporting", num: 12, name: "Reporting & Analytics", path: "/dashboard/reporting" },
  { key: "agency-brain", num: 13, name: "Agency Brain", path: "/dashboard/agency-brain" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

// Path prefix → section key (WhatsApp Task Bar rides on the Approvals permission).
export const SECTION_BY_PREFIX: Record<string, string> = {
  ...Object.fromEntries(SECTIONS.map((s) => [s.path, s.key])),
  "/dashboard/whatsapp-inbox": "approvals",
};

export function sectionKeyForPath(path: string): string | null {
  const hit = Object.keys(SECTION_BY_PREFIX)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + "/"));
  return hit ? SECTION_BY_PREFIX[hit] : null;
}
