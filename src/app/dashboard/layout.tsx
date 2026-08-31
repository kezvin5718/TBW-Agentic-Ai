import React from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import GlobalErrorMonitor from "./GlobalErrorMonitor";
import SidebarNav from "./SidebarNav";
import AccountControls from "./AccountControls";
import { sectionKeyForPath } from "@/lib/sections";
import { NAVIGATION } from "@/lib/navigation";

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

  // The nav is config now (src/lib/navigation.ts) — same routes, grouped by
  // workstream. The filter below is the one this layout always used, applied
  // per item; a section left with no visible item is dropped whole, so a
  // non-founder never meets an empty "Founder & Finance" heading.
  const visibleSections = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      const sectionKey = sectionKeyForPath(item.href);
      if (role === "employee" && perms) {
        // Explicit permission list: workflow sections follow the list exactly
        // (including granting normally-founder-only ones like Onboarding).
        if (sectionKey) return perms.includes(sectionKey);
        return (item.roles as readonly string[]).includes(role);
      }
      return (item.roles as readonly string[]).includes(role);
    }),
  })).filter((section) => section.items.length > 0);

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
        sections={visibleSections.map((s) => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          items: s.items.map((i) => ({
            id: i.id,
            label: i.label,
            href: i.href,
            icon: i.icon,
            roles: i.roles,
            ...(i.badge ? { badge: i.badge } : {}),
            ...(i.group ? { group: i.group } : {}),
          })),
        }))}
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
