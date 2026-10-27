import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isOurStorageUrl, thumbnailFromUrl } from "@/lib/video-thumbnail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/thumbnails/from-url { url, clientId? } → { url, name }
 *
 * The automatic frame for a video that has no hub row — Compose's direct
 * uploads. Same fetch, frame choice and storage as the engine; nothing is
 * written to any record, the composer decides what to do with it. Only files
 * our own storage handed out are accepted, as with the cover matcher.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown; clientId?: unknown };
  const url = String(body.url || "");
  if (!isOurStorageUrl(url)) {
    return NextResponse.json({ error: "That video is not one of our stored files" }, { status: 400 });
  }

  // Filed under the client being composed for, when there is one.
  let clientName: string | undefined;
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (/^[0-9a-f-]{36}$/i.test(clientId)) {
    const { data: client } = await createServiceRoleClient().from("clients").select("name").eq("id", clientId).maybeSingle();
    clientName = (client?.name as string | undefined) || undefined;
  }

  try {
    const thumb = await thumbnailFromUrl(url, clientName);
    return NextResponse.json({ success: true, url: thumb.url, name: thumb.name });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
