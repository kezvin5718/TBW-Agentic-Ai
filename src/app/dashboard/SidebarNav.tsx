"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLogo from "./BrandLogo";
import Avatar from "./Avatar";
import PendingSignupsBadge from "./PendingSignupsBadge";
import AccountControls from "./AccountControls";
import { NAV_OPEN_KEY, type NavSection } from "@/lib/navigation";
import {
  Sparkles,
  LayoutDashboard,
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
  Home,
  Compass,
  ClipboardCheck,
  Brush,
  MessagesSquare,
  Target,
  BarChart3,
  Cpu,
  SlidersHorizontal,
  Landmark,
  ChevronRight,
  LogOut,
} from "lucide-react";

/**
 * The console's navigation — one sidebar on a desk, a slide-over drawer on a
 * phone.
 *
 * Below lg the whole menu used to render full-width ABOVE the page, so a phone
 * scrolled through the entire nav before reaching any content. The markup is
 * written once and mounted twice: the drawer and the desk sidebar show the
 * same panel, so the two can never drift.
 *
 * The items themselves are config (`src/lib/navigation.ts`), already filtered
 * by the layout. Sections collapse; the one holding the current page is always
 * opened on navigation; everything else remembers what the person last chose.
 *
 * A component function cannot cross the server/client boundary, so the layout
 * passes icon names and this map turns them back into icons.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, UserPlus, BrainCircuit, ClipboardList, CheckSquare, ListTodo,
  Phone, Palette, Wand2, Image, Shield, FolderUp, Sparkles, Send, UploadCloud,
  Megaphone, LineChart, Layers, UserIcon, Users, Bot, Link2, Share2, Settings,
  IndianRupee, Wallet, Briefcase,
  // Section headers
  Home, Compass, ClipboardCheck, Brush, MessagesSquare, Target, BarChart3, Cpu,
  SlidersHorizontal, Landmark,
};

interface Props {
  sections: NavSection[];
  name: string;
  email: string;
  designation: string | null;
  avatarUrl: string | null;
  role: string;
  brandName: string;
  roleStyle: { bg: string; label: string; icon: string };
}

export default function SidebarNav({ sections, name, email, designation, avatarUrl, role, brandName, roleStyle }: Props) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname() || "";

  // The page behind the drawer must not scroll under the thumb.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  // Which item is the current page: longest matching prefix, so /dashboard
  // (a prefix of everything) only ever lights up on itself.
  const activeHref = useMemo(() => {
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    const matches = hrefs.filter((href) =>
      href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(href + "/")
    );
    return matches.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [sections, pathname]);

  const activeSectionId = useMemo(
    () => sections.find((s) => s.items.some((i) => i.href === activeHref))?.id ?? null,
    [sections, activeHref]
  );

  // Expanded sections, remembered per person. Empty until the effect below has
  // read localStorage — see the firstPersist guard.
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let saved: Record<string, boolean> | null = null;
    try {
      const raw = localStorage.getItem(NAV_OPEN_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
    } catch { /* a preference is not worth an error */ }
    // First ever visit: only the section holding the current page is open.
    setOpenIds(saved ?? (activeSectionId ? { [activeSectionId]: true } : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip the very first run: it fires with the empty default before the effect
  // above has restored the saved map, and would overwrite it.
  const firstPersist = useRef(true);
  useEffect(() => {
    if (firstPersist.current) { firstPersist.current = false; return; }
    try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(openIds)); } catch { /* ignore */ }
  }, [openIds]);

  // Navigating into a collapsed section opens it — nobody should land on a page
  // they cannot see in the menu. Collapsing it again by hand still works.
  useEffect(() => {
    if (!activeSectionId) return;
    setOpenIds((prev) => (prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true }));
  }, [activeSectionId]);

  // The avatar menu closes on a click anywhere else and on Escape. The panel is
  // mounted twice, so the check is by attribute rather than by ref.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-user-menu]")) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const RoleBadgeIcon = ICONS[roleStyle.icon] || Shield;

  const closeAll = () => { setOpen(false); setMenuOpen(false); };

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

      {/* User card — the menu that holds the profile and the way out */}
      <div className="p-4 border-b border-slate-900">
        <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-3 flex flex-col space-y-2">
          <div className="relative" data-user-menu>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Your account"
              className="w-full flex items-center space-x-3 group cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <Avatar name={name} url={avatarUrl} size={36} />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-bold text-slate-200 truncate group-hover:text-[var(--yellow)] transition-colors">{name}</p>
                <p className="text-[10px] text-slate-500 truncate">{designation || email}</p>
              </div>
              <ChevronRight className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${menuOpen ? "rotate-90" : ""}`} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-slate-800 bg-slate-950 shadow-xl shadow-black/40 p-1"
              >
                <Link
                  href="/dashboard/profile"
                  role="menuitem"
                  onClick={closeAll}
                  className="flex items-center gap-2.5 min-h-[40px] px-3 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <UserIcon className="w-4 h-4 text-slate-500" />
                  <span>My Profile</span>
                </Link>
                <form action="/auth/signout" method="POST">
                  <button
                    type="submit"
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 min-h-[40px] px-3 rounded-lg text-xs font-medium text-slate-300 hover:text-red-400 hover:bg-red-950/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <LogOut className="w-4 h-4 text-slate-500" />
                    <span>Sign Out</span>
                  </button>
                </form>
              </div>
            )}
          </div>

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

      {/* Sidebar nav — workstream sections, each one collapsible */}
      <nav className="flex-1 p-4 overflow-y-auto" aria-label="Console sections">
        <ul className="space-y-1">
          {sections.map((section) => {
            const SectionIcon = ICONS[section.icon] || LayoutDashboard;
            const expanded = !!openIds[section.id];
            const listId = `nav-section-${section.id}`;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => setOpenIds((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  aria-expanded={expanded}
                  aria-controls={listId}
                  className="w-full flex items-center gap-2 px-3 min-h-[36px] rounded-lg text-[10px] font-bold text-slate-500 uppercase tracking-wider hover:text-slate-300 hover:bg-slate-900/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                  <SectionIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1 text-left truncate">{section.label}</span>
                </button>

                {expanded && (
                  <ul id={listId} className="mt-1 mb-2 space-y-1">
                    {section.items.map((item, idx) => {
                      const Icon = ICONS[item.icon] || LayoutDashboard;
                      const isActive = item.href === activeHref;
                      const showGroup = !!item.group && section.items[idx - 1]?.group !== item.group;
                      return (
                        <React.Fragment key={item.href}>
                          {showGroup && (
                            <li aria-hidden="true" className="pl-9 pr-3 pt-1.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                              {item.group}
                            </li>
                          )}
                          <li>
                            <Link
                              href={item.href}
                              onClick={closeAll}
                              aria-current={isActive ? "page" : undefined}
                              className={`relative flex items-center space-x-3 px-3 min-h-[40px] rounded-lg text-sm border transition-all group ${item.group ? "ml-3" : ""} ${
                                isActive
                                  ? "bg-indigo-950/40 border-indigo-900/60 text-white font-semibold"
                                  : "text-slate-400 font-medium border-transparent hover:text-white hover:bg-slate-900/50 hover:border-slate-900"
                              }`}
                            >
                              {isActive && (
                                <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-indigo-400" />
                              )}
                              <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-indigo-300" : "text-slate-500 group-hover:text-indigo-400"}`} />
                              <span className="truncate">{item.label}</span>
                              {item.badge === "pendingSignups" && <PendingSignupsBadge />}
                            </Link>
                          </li>
                        </React.Fragment>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

    </>
  );

  return (
    <>
      {/* Below lg — the bar that replaces the full-page menu */}
      <div className="lg:hidden flex items-center justify-between h-14 px-4 bg-slate-950/60 backdrop-blur-md border-b border-slate-900 shrink-0">
        <Link href="/dashboard" className="flex items-center group min-w-0">
          <BrandLogo />
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <AccountControls />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
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
