import React from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import GlobalErrorMonitor from "./GlobalErrorMonitor";
import SidebarNav from "./SidebarNav";
import AccountControls from "./AccountControls";
import { sectionKeyForPath } from "@/lib/sections";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = user.user_metadata?.role || "client";
  const brandName = user.user_metadata?.brand_name || "";
  const name = user.user_metadata?.name || user.email?.split("@")[0] || "User";

  // Per-user section permissions (employees): NULL = default set; array = only those.
  const { data: prof } = await supabase
    .from("profiles")
    .select("permissions, avatar_url, designation")
    .eq("id", user.id)
    .maybeSingle();
  const perms: string[] | null = role === "employee" ? ((prof?.permissions as string[] | null) ?? null) : null;

  // Full map of modular nav items. Icons travel as names — a component function
  // cannot cross into the client sidebar, and everything else here is plain data.
  const allNavItems = [
    { name: "Console Home", href: "/dashboard", icon: "LayoutDashboard", roles: ["founder", "employee", "client"], section: "Overview" },

    { name: "1 · Client Onboarding", href: "/dashboard/onboarding", icon: "UserPlus", roles: ["founder"], section: "Client Workflow" },
    { name: "2 · Brand Brain", href: "/dashboard/brand-brain", icon: "BrainCircuit", roles: ["founder", "employee", "client"], section: "Client Workflow" },
    { name: "3 · Campaign Planning", href: "/dashboard/planning", icon: "ClipboardList", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "4 · Approvals Flow", href: "/dashboard/approvals", icon: "CheckSquare", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "Task Manager", href: "/dashboard/task-manager", icon: "ListTodo", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "Call Notes", href: "/dashboard/calls", icon: "Phone", roles: ["founder"], section: "Client Workflow" },
    { name: "5 · Style Library", href: "/dashboard/style-library", icon: "Palette", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "5b · Plan → Posts", href: "/dashboard/production/plan-posts", icon: "Wand2", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "6 · Image Studio", href: "/dashboard/image-studio", icon: "Image", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "7 · Creative Approvals", href: "/dashboard/creatives-review", icon: "Shield", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "8 · Content Hub", href: "/dashboard/content-hub", icon: "FolderUp", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "8b · Festivals", href: "/dashboard/festivals", icon: "Sparkles", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "9 · Social Publisher", href: "/dashboard/social-publisher", icon: "Send", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "10 · Ad Publishing", href: "/dashboard/publishing", icon: "UploadCloud", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "11 · Meta Ads Manager", href: "/dashboard/ads", icon: "Megaphone", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "11b · Catalogue Ad Copy", href: "/dashboard/ad-copy", icon: "Sparkles", roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "12 · Reporting & Analytics", href: "/dashboard/reporting", icon: "LineChart", roles: ["founder", "employee", "client"], section: "Client Workflow" },
    { name: "13 · Agency Brain", href: "/dashboard/agency-brain", icon: "Layers", roles: ["founder"], section: "Client Workflow" },

    { name: "My Profile", href: "/dashboard/profile", icon: "UserIcon", roles: ["founder", "employee", "client"], section: "Assistant & System" },
    { name: "Team & Access", href: "/dashboard/team", icon: "Users", roles: ["founder"], section: "Assistant & System" },
    { name: "Bron Assistant", href: "/dashboard/jarvis", icon: "Bot", roles: ["founder"], section: "Assistant & System" },
    { name: "WhatsApp Reader", href: "/dashboard/whatsapp-reader", icon: "Link2", roles: ["founder"], section: "Assistant & System" },
    { name: "Agents Console", href: "/dashboard/connections", icon: "Share2", roles: ["founder", "employee"], section: "Assistant & System" },
    { name: "Integrations", href: "/dashboard/settings/integrations", icon: "Settings", roles: ["founder"], section: "Assistant & System" },

    { name: "Accounting", href: "/dashboard/founder-zone/accounting", icon: "IndianRupee", roles: ["founder"], section: "Founder Zone" },
    { name: "Credit Logs", href: "/dashboard/credit-logs", icon: "Wallet", roles: ["founder"], section: "Founder Zone" },
  ];

  const filteredNavItems = allNavItems.filter((item) => {
    const sectionKey = sectionKeyForPath(item.href);
    if (role === "employee" && perms) {
      // Explicit permission list: workflow sections follow the list exactly
      // (including granting normally-founder-only ones like Onboarding).
      if (sectionKey) return perms.includes(sectionKey);
      return item.roles.includes(role);
    }
    return item.roles.includes(role);
  });

  // Role styles
  const roleStyles = {
    founder: { bg: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50", label: "Founder", icon: "Shield" },
    employee: { bg: "bg-violet-950/40 text-violet-400 border-violet-800/50", label: "Operations", icon: "Briefcase" },
    client: { bg: "bg-indigo-950/40 text-indigo-400 border-indigo-800/50", label: "Client Partner", icon: "UserIcon" },
  };

  const currentRoleStyle = roleStyles[role as keyof typeof roleStyles] || roleStyles.client;

  return (
    <div className="min-h-screen bg-[var(--ink)] text-slate-100 flex flex-col lg:flex-row font-sans">
      <SidebarNav
        navItems={filteredNavItems.map(({ name, href, section, icon }) => ({ name, href, section, icon }))}
        name={name}
        email={user.email || ""}
        designation={(prof?.designation as string | null) || null}
        avatarUrl={(prof?.avatar_url as string | null) || null}
        role={role}
        brandName={brandName}
        roleStyle={currentRoleStyle}
      />

      {/* Main dashboard content */}
      <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* TBW ambient layer — gold + cyan glows behind a faint grid */}
        <div className="absolute top-[-12%] left-[-8%] w-[45%] h-[45%] rounded-full blur-[90px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(255,212,0,0.13), transparent 65%)" }} />
        <div className="absolute bottom-[-12%] right-[-6%] w-[42%] h-[42%] rounded-full blur-[90px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(0,229,255,0.08), transparent 65%)" }} />
        <div className="tbw-grid-layer" />

        {/* Account strip — a row of its own, not an overlay. Many pages already
            put their own controls in the top-right corner (Scan new, Refresh,
            tab strips); an absolutely positioned cluster would sit on top of
            them. Below lg these controls live in the mobile top bar instead. */}
        <div className="hidden lg:flex justify-end items-center h-12 px-10 shrink-0 relative z-10">
          <AccountControls />
        </div>

        {/* Content wrapper */}
        <div className="flex-1 p-4 sm:p-6 md:p-10 z-10 overflow-y-auto relative">
          {children}
        </div>
      </main>

      {/* Always-on background error monitor (every dashboard page) */}
      <GlobalErrorMonitor />
    </div>
  );
}
