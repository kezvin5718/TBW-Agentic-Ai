import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { sectionKeyForPath } from "@/lib/sections";

export async function middleware(request: NextRequest) {
  const { supabase, user, response } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const envUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital";
  const baseAppUrl = (envUrl.includes("next_public") || envUrl.includes("0.0.0.0") || envUrl.includes("localhost"))
    ? "https://bron.digital"
    : envUrl.trim().replace(/\/+$/, "");

  // 1. Redirect root to /dashboard
  if (path === "/") {
    const targetUrl = new URL(user ? "/dashboard" : "/login", baseAppUrl);
    return NextResponse.redirect(targetUrl);
  }

  // 2. Unauthenticated user redirects
  if (!user) {
    if (path.startsWith("/dashboard") || path === "/pending") {
      const loginUrl = new URL("/login", baseAppUrl);
      if (path.startsWith("/dashboard")) loginUrl.searchParams.set("next", path);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // 3. Authenticated user visiting login page redirects to dashboard
  if (path === "/login") {
    const dashboardUrl = new URL("/dashboard", baseAppUrl);
    return NextResponse.redirect(dashboardUrl);
  }

  // 3.5 Account-approval gate — new signups must be approved by a founder.
  let isApproved = true;
  let perms: string[] | null = null;
  try {
    const { data: myProfile } = await supabase.from("profiles").select("approved, permissions").eq("id", user.id).maybeSingle();
    isApproved = myProfile?.approved === true;
    perms = (myProfile?.permissions as string[] | null) ?? null;
  } catch {
    isApproved = true; // fail open if the check errors (don't lock people out on a glitch)
  }
  if (path === "/pending") {
    if (isApproved) return NextResponse.redirect(new URL("/dashboard", baseAppUrl));
    return response;
  }
  if (!isApproved && path.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/pending", baseAppUrl));
  }

  // 4. Role-based Route Protection
  const role = user.user_metadata?.role || "client";

  if (
    path.startsWith("/dashboard/jarvis") ||
    path.startsWith("/dashboard/team") ||
    path.startsWith("/dashboard/founder-zone")
  ) {
    if (role !== "founder") {
      const homeUrl = new URL("/dashboard", baseAppUrl);
      return NextResponse.redirect(homeUrl);
    }
  }

  // Onboarding: founder, or an employee explicitly granted the section.
  if (path.startsWith("/dashboard/onboarding")) {
    const allowed = role === "founder" || (role === "employee" && Array.isArray(perms) && perms.includes("onboarding"));
    if (!allowed) return NextResponse.redirect(new URL("/dashboard", baseAppUrl));
  }

  // Employee section permissions: when an explicit list is set, only those
  // workflow sections are reachable — direct URLs included.
  if (role === "employee" && Array.isArray(perms)) {
    const sectionKey = sectionKeyForPath(path);
    if (sectionKey && !perms.includes(sectionKey)) {
      return NextResponse.redirect(new URL("/dashboard", baseAppUrl));
    }
  }

  if (role === "client") {
    // Clients can ONLY access:
    // - Dashboard home (/dashboard)
    // - Reporting (/dashboard/reporting)
    // - Brand Brain (/dashboard/brand-brain)
    const allowedPaths = [
      "/dashboard",
      "/dashboard/reporting",
      "/dashboard/brand-brain",
    ];
    
    // Check if client is trying to access a restricted route (e.g. production, planning, approvals)
    if (path.startsWith("/dashboard")) {
      const isAllowed = allowedPaths.some(
        (allowedPath) => path === allowedPath || path.startsWith(allowedPath + "/")
      );
      
      if (!isAllowed) {
        // Redirect client back to reporting dashboard
        const clientHomeUrl = new URL("/dashboard", baseAppUrl);
        return NextResponse.redirect(clientHomeUrl);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes authenticate themselves; running middleware on them
     *   imposes Next's 10MB middleware body limit, breaking large uploads)
     * - _next/static, _next/image, favicon.ico, image files
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
