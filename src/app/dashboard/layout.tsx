import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
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
  Settings
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

  // Full map of modular nav items
  const allNavItems = [
    { name: "Console Home", href: "/dashboard", icon: LayoutDashboard, roles: ["founder", "employee", "client"] },
    { name: "Bron Assistant", href: "/dashboard/jarvis", icon: Bot, roles: ["founder"] },
    { name: "Image Studio", href: "/dashboard/image-studio", icon: Image, roles: ["founder", "employee"] },
    { name: "Client Onboarding", href: "/dashboard/onboarding", icon: UserPlus, roles: ["founder"] },
    { name: "Brand Brain", href: "/dashboard/brand-brain", icon: BrainCircuit, roles: ["founder", "employee", "client"] },
    { name: "Campaign Planning", href: "/dashboard/planning", icon: ClipboardList, roles: ["founder", "employee"] },
    { name: "Approvals Flow", href: "/dashboard/approvals", icon: CheckSquare, roles: ["founder", "employee"] },
    { name: "Creative Approvals", href: "/dashboard/creatives-review", icon: Shield, roles: ["founder", "employee"] },
    { name: "Ad Production", href: "/dashboard/production", icon: Clapperboard, roles: ["founder", "employee"] },
    { name: "Ad Publishing", href: "/dashboard/publishing", icon: UploadCloud, roles: ["founder", "employee"] },
    { name: "Meta Ads Manager", href: "/dashboard/ads", icon: Megaphone, roles: ["founder", "employee"] },
    { name: "Reporting & Analytics", href: "/dashboard/reporting", icon: LineChart, roles: ["founder", "employee", "client"] },
    { name: "Agency Brain", href: "/dashboard/agency-brain", icon: Layers, roles: ["founder"] },
    { name: "Integrations", href: "/dashboard/settings/integrations", icon: Settings, roles: ["founder"] },
  ];

  const filteredNavItems = allNavItems.filter((item) => item.roles.includes(role));

  // Role styles
  const roleStyles = {
    founder: { bg: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50", label: "Founder", icon: Shield },
    employee: { bg: "bg-violet-950/40 text-violet-400 border-violet-800/50", label: "Operations", icon: Briefcase },
    client: { bg: "bg-indigo-950/40 text-indigo-400 border-indigo-800/50", label: "Client Partner", icon: UserIcon },
  };

  const currentRoleStyle = roleStyles[role as keyof typeof roleStyles] || roleStyles.client;
  const RoleBadgeIcon = currentRoleStyle.icon;

  return (
    <div className="min-h-screen bg-[#07070a] text-slate-100 flex flex-col lg:flex-row font-sans">
      {/* Sidebar - Desktop */}
      <aside className="w-full lg:w-72 bg-slate-950/60 backdrop-blur-md border-b lg:border-b-0 lg:border-r border-slate-900 flex flex-col shrink-0">
        {/* Brand header */}
        <div className="h-20 flex items-center px-6 border-b border-slate-900 justify-between">
          <Link href="/dashboard" className="flex items-center space-x-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-950/50">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg text-white tracking-tight group-hover:text-indigo-400 transition-colors">
              tbw-os
            </span>
          </Link>
          <div className="flex items-center space-x-1.5 bg-slate-900/50 border border-slate-800/60 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider">v0.1</span>
          </div>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-slate-900">
          <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-3 flex flex-col space-y-2">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-900/40 border border-indigo-800/50 flex items-center justify-center font-bold text-indigo-300 text-sm">
                {name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-200 truncate">{name}</p>
                <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
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

        {/* Sidebar Nav */}
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">Available Modules</p>
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-900/50 border border-transparent hover:border-slate-900 transition-all group"
              >
                <Icon className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer / Signout */}
        <div className="p-4 border-t border-slate-900">
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
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Glow effect */}
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-950/10 blur-[100px] pointer-events-none" />
        
        {/* Content wrapper */}
        <div className="flex-1 p-6 md:p-10 z-10 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
