import React from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import GlobalErrorMonitor from "./GlobalErrorMonitor";
import BrandLogo from "./BrandLogo";
import Avatar from "./Avatar";
import PendingSignupsBadge from "./PendingSignupsBadge";
import ThemeToggle from "./ThemeToggle";
import { sectionKeyForPath } from "@/lib/sections";
import {
  Sparkles,
  LayoutDashboard,
  LogOut,
  UserPlus,
  BrainCircuit,
  ClipboardList,
  CheckSquare,
  Clapperboard,
  UploadCloud,
  Megaphone,
  LineChart,
  Shield,
  Briefcase,
  User as UserIcon,
  Layers,
  Bot,
  Image,
  Settings,
  FolderUp,
  Share2,
  Link2,
  Users,
  Send,
  ListTodo,
  Wand2,
  Phone,
  IndianRupee
} from "lucide-react";

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

  // Full map of modular nav items
  const allNavItems = [
    { name: "Console Home", href: "/dashboard", icon: LayoutDashboard, roles: ["founder", "employee", "client"], section: "Overview" },

    { name: "1 · Client Onboarding", href: "/dashboard/onboarding", icon: UserPlus, roles: ["founder"], section: "Client Workflow" },
    { name: "2 · Brand Brain", href: "/dashboard/brand-brain", icon: BrainCircuit, roles: ["founder", "employee", "client"], section: "Client Workflow" },
    { name: "3 · Campaign Planning", href: "/dashboard/planning", icon: ClipboardList, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "4 · Approvals Flow", href: "/dashboard/approvals", icon: CheckSquare, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "Task Manager", href: "/dashboard/task-manager", icon: ListTodo, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "Call Notes", href: "/dashboard/calls", icon: Phone, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "5 · Ad Production", href: "/dashboard/production", icon: Clapperboard, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "5b · Plan → Posts", href: "/dashboard/production/plan-posts", icon: Wand2, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "6 · Image Studio", href: "/dashboard/image-studio", icon: Image, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "7 · Creative Approvals", href: "/dashboard/creatives-review", icon: Shield, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "8 · Content Hub", href: "/dashboard/content-hub", icon: FolderUp, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "9 · Social Publisher", href: "/dashboard/social-publisher", icon: Send, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "10 · Ad Publishing", href: "/dashboard/publishing", icon: UploadCloud, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "11 · Meta Ads Manager", href: "/dashboard/ads", icon: Megaphone, roles: ["founder", "employee"], section: "Client Workflow" },
    { name: "12 · Reporting & Analytics", href: "/dashboard/reporting", icon: LineChart, roles: ["founder", "employee", "client"], section: "Client Workflow" },
    { name: "13 · Agency Brain", href: "/dashboard/agency-brain", icon: Layers, roles: ["founder"], section: "Client Workflow" },

    { name: "My Profile", href: "/dashboard/profile", icon: UserIcon, roles: ["founder", "employee", "client"], section: "Assistant & System" },
    { name: "Team & Access", href: "/dashboard/team", icon: Users, roles: ["founder"], section: "Assistant & System" },
    { name: "Bron Assistant", href: "/dashboard/jarvis", icon: Bot, roles: ["founder"], section: "Assistant & System" },
    { name: "WhatsApp Reader", href: "/dashboard/whatsapp-reader", icon: Link2, roles: ["founder"], section: "Assistant & System" },
    { name: "Agents Console", href: "/dashboard/connections", icon: Share2, roles: ["founder", "employee"], section: "Assistant & System" },
    { name: "Integrations", href: "/dashboard/settings/integrations", icon: Settings, roles: ["founder"], section: "Assistant & System" },

    { name: "Accounting", href: "/dashboard/founder-zone/accounting", icon: IndianRupee, roles: ["founder"], section: "Founder Zone" },
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
    founder: { bg: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50", label: "Founder", icon: Shield },
    employee: { bg: "bg-violet-950/40 text-violet-400 border-violet-800/50", label: "Operations", icon: Briefcase },
    client: { bg: "bg-indigo-950/40 text-indigo-400 border-indigo-800/50", label: "Client Partner", icon: UserIcon },
  };

  const currentRoleStyle = roleStyles[role as keyof typeof roleStyles] || roleStyles.client;
  const RoleBadgeIcon = currentRoleStyle.icon;

  return (
    <div className="min-h-screen bg-[var(--ink)] text-slate-100 flex flex-col lg:flex-row font-sans">
      {/* Sidebar - Desktop */}
      <aside className="w-full lg:w-72 bg-slate-950/60 backdrop-blur-md border-b lg:border-b-0 lg:border-r border-slate-900 flex flex-col shrink-0">
        {/* Brand header */}
        <div className="h-20 flex items-center px-6 border-b border-slate-900 justify-between">
          <Link href="/dashboard" className="flex items-center group">
            <BrandLogo />
          </Link>
          <div className="flex items-center space-x-1.5 bg-slate-900/50 border border-slate-800/60 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3 text-[var(--yellow)]" />
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider signal">v0.1</span>
          </div>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-slate-900">
          <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-3 flex flex-col space-y-2">
            <Link href="/dashboard/profile" className="flex items-center space-x-3 group" title="Edit your profile">
              <Avatar name={name} url={prof?.avatar_url as string | null} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-200 truncate group-hover:text-[var(--yellow)] transition-colors">{name}</p>
                <p className="text-[10px] text-slate-500 truncate">{(prof?.designation as string | null) || user.email}</p>
              </div>
            </Link>
            <div className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold w-fit ${currentRoleStyle.bg}`}>
              <RoleBadgeIcon className="w-3 h-3" />
              <span>{currentRoleStyle.label}</span>
              {role === "client" && brandName && (
                <span className="border-l border-indigo-800/60 pl-1.5 ml-1.5 text-indigo-300 truncate max-w-[100px]">
                  {brandName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Nav — ordered to follow the workflow, grouped by section */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {filteredNavItems.map((item, idx) => {
            const Icon = item.icon;
            const showHeader = idx === 0 || filteredNavItems[idx - 1].section !== item.section;
            return (
              <React.Fragment key={item.href}>
                {showHeader && (
                  <p className={`text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2 ${idx === 0 ? "" : "mt-4"}`}>
                    {item.section}
                  </p>
                )}
                <Link
                  href={item.href}
                  className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-900/50 border border-transparent hover:border-slate-900 transition-all group"
                >
                  <Icon className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                  <span className="font-medium">{item.name}</span>
                  {item.href === "/dashboard/team" && <PendingSignupsBadge />}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        {/* Sidebar Footer / Theme + Signout */}
        <div className="p-4 border-t border-slate-900">
          <ThemeToggle />
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg border border-slate-950 text-slate-400 hover:text-red-400 hover:bg-red-950/20 hover:border-red-950/50 text-sm font-semibold transition-all cursor-pointer group"
            >
              <LogOut className="w-4 h-4 text-slate-500 group-hover:text-red-400 transition-colors" />
              <span>Logout Console</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Main dashboard content */}
      <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* TBW ambient layer — gold + cyan glows behind a faint grid */}
        <div className="absolute top-[-12%] left-[-8%] w-[45%] h-[45%] rounded-full blur-[90px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(255,212,0,0.13), transparent 65%)" }} />
        <div className="absolute bottom-[-12%] right-[-6%] w-[42%] h-[42%] rounded-full blur-[90px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(0,229,255,0.08), transparent 65%)" }} />
        <div className="tbw-grid-layer" />

        {/* Content wrapper */}
        <div className="flex-1 p-6 md:p-10 z-10 overflow-y-auto relative">
          {children}
        </div>
      </main>

      {/* Always-on background error monitor (every dashboard page) */}
      <GlobalErrorMonitor />
    </div>
  );
}
