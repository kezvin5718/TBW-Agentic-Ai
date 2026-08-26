import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeCaptionForClient } from "@/lib/caption-engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/social-publisher/generate-caption
 * Body: { clientId, platform, contentType, brief?, model?, mediaUrl?, mediaIsVideo?, thumbnailUrl? }
 *
 * The composer's way in. The writing itself lives in the caption engine, so
 * that the rest of the app can reach it without calling this app over HTTP and
 * hoping the session survives the hop — which, in production, it does not.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.clientId) return NextResponse.json({ error: "Select a client first" }, { status: 400 });

  const result = await writeCaptionForClient({
    clientId: body.clientId,
    platform: body.platform,
    contentType: body.contentType,
    brief: body.brief,
    model: body.model,
    mediaUrl: body.mediaUrl,
    mediaIsVideo: body.mediaIsVideo,
    thumbnailUrl: body.thumbnailUrl,
    visionDescription: body.visionDescription,
    onCreativeText: body.onCreativeText,
  });

  if (!result.ok) {
    // A missing address is the client's record to fix, not this request's
    // fault; a missing client is a 404 as it always was.
    if (result.code === "missing_contact") {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }
    if (result.code === "no_client") return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    caption: result.caption,
    model: result.model,
    bodyWords: result.bodyWords,
  });
}
