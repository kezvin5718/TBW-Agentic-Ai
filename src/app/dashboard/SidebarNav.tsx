"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import BrandLogo from "./BrandLogo";
import Avatar from "./Avatar";
import PendingSignupsBadge from "./PendingSignupsBadge";
import ThemeToggle from "./ThemeToggle";
import {
  Sparkles,
  LayoutDashboard,
  LogOut,
  UserPlus,
  BrainCircuit,
  ClipboardList,
  CheckSquare,
  Palette,
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
  IndianRupee,
  Wallet,
  Menu,
} from "lucide-react";

/**
 * The console's navigation — one sidebar on a desk, a slide-over drawer on a
 * phone.
 *
 * Below lg the whole 25-item menu used to render full-width ABOVE the page, so
 * a phone scrolled through the entire nav before reaching any content. The
 * markup is written once and mounted twice: the drawer and the desk sidebar
 * show the same panel, so the two can never drift.
 *
 * A component function cannot cross the server/client boundary, so the layout
 * passes icon names and this map turns them back into icons.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, UserPlus, BrainCircuit, ClipboardList, CheckSquare, ListTodo,
  Phone, Palette, Wand2, Image, Shield, FolderUp, Sparkles, Send, UploadCloud,
  Megaphone, LineChart, Layers, UserIcon, Users, Bot, Link2, Share2, Settings,
  IndianRupee, Wallet, Briefcase,
};

export interface NavItem {
  name: string;
  href: string;
  section: string;
  icon: string;
}

interface Props {
  navItems: NavItem[];
  name: string;
  email: string;
  designation: string | null;
  avatarUrl: string | null;
  role: string;
  brandName: string;
  roleStyle: { bg: string; label: string; icon: string };
}

export default function SidebarNav({ navItems, name, email, designation, avatarUrl, role, brandName, roleStyle }: Props) {
  const [open, setOpen] = useState(false);

  // The page behind the drawer must not scroll under the thumb.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const RoleBadgeIcon = ICONS[roleStyle.icon] || Shield;

  const panel = (
    <>
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
          <Link href="/dashboard/profile" onClick={() => setOpen(false)} className="flex items-center space-x-3 group" title="Edit your profile">
            <Avatar name={name} url={avatarUrl} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-200 truncate group-hover:text-[var(--yellow)] transition-colors">{name}</p>
              <p className="text-[10px] text-slate-500 truncate">{designation || email}</p>
            </div>
          </Link>
          <div className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold w-fit ${roleStyle.bg}`}>
            <RoleBadgeIcon className="w-3 h-3" />
            <span>{roleStyle.label}</span>
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
        {navItems.map((item, idx) => {
          const Icon = ICONS[item.icon] || LayoutDashboard;
          const showHeader = idx === 0 || navItems[idx - 1].section !== item.section;
          return (
            <React.Fragment key={item.href}>
              {showHeader && (
                <p className={`text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2 ${idx === 0 ? "" : "mt-4"}`}>
                  {item.section}
                </p>
              )}
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
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
    </>
  );

  return (
    <>
      {/* Below lg — the bar that replaces the full-page menu */}
      <div className="lg:hidden flex items-center justify-between h-14 px-4 bg-slate-950/60 backdrop-blur-md border-b border-slate-900 shrink-0">
        <Link href="/dashboard" className="flex items-center group">
          <BrandLogo />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-white cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Below lg — the drawer itself */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] h-full bg-slate-950 border-r border-slate-900 flex flex-col">
            {panel}
          </aside>
        </div>
      )}

      {/* lg and up — today's sidebar, unchanged */}
      <aside className="hidden lg:flex lg:w-72 bg-slate-950/60 backdrop-blur-md lg:border-r border-slate-900 flex-col shrink-0">
        {panel}
      </aside>
    </>
  );
}
