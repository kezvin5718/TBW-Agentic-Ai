import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

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
  try {
    const { data: myProfile } = await supabase.from("profiles").select("approved").eq("id", user.id).maybeSingle();
    isApproved = myProfile?.approved === true;
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
    path.startsWith("/dashboard/onboarding") ||
    path.startsWith("/dashboard/team") ||
    path.startsWith("/dashboard/founder-zone")
  ) {
    if (role !== "founder") {
      const homeUrl = new URL("/dashboard", baseAppUrl);
      return NextResponse.redirect(homeUrl);
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
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
