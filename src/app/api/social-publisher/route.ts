import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";

export const dynamic = "force-dynamic";

// GET — post history (newest first).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("social_posts")
    .select("*, clients(name), profiles:created_by(name)")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, posts: data || [] });
}

// POST — fire the Zapier webhook (one call per platform × content type) + log history.
// Body: { clientId, platforms[], contentTypes[] (or contentType), title, caption,
//         mediaUrl, thumbnailUrl?, scheduledFor, uploadId? (Content Hub item) }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { clientId, platforms, title, caption, mediaUrl, thumbnailUrl, scheduledFor, uploadId } = body;
  const contentTypes: string[] = Array.isArray(body.contentTypes) ? body.contentTypes : body.contentType ? [body.contentType] : [];
  if (!clientId) return NextResponse.json({ error: "Select a client" }, { status: 400 });
  if (!Array.isArray(platforms) || platforms.length === 0) return NextResponse.json({ error: "Select at least one platform" }, { status: 400 });
  if (!mediaUrl) return NextResponse.json({ error: "Upload or pick the media first" }, { status: 400 });
  if (contentTypes.length === 0 || contentTypes.some((t) => !["post", "reel", "story"].includes(t))) {
    return NextResponse.json({ error: "Select 1–2 valid content types" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const viaRecurPost = isRecurPostConfigured();

  // Zapier webhook fallback (used only when RecurPost is not configured)
  let webhookUrl: string | undefined;
  let rpMapping: Record<string, { client_id: string; platform: string }> = {};
  if (viaRecurPost) {
    const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
    rpMapping = (mapRow?.value as typeof rpMapping) || {};
  } else {
    const { data: hookRow } = await admin.from("agency_settings").select("value").eq("key", "zapier_webhook_url").maybeSingle();
    webhookUrl = (hookRow?.value as { url?: string } | null)?.url;
    if (!webhookUrl) {
      return NextResponse.json({ error: "No posting connection configured — set RecurPost keys in .env or a Zapier webhook URL (founder, Settings on this page)." }, { status: 400 });
    }
  }

  const mediaIsVideo = !!body.mediaIsVideo || /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(mediaUrl);
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();
  const { data: creds } = await admin.from("client_credentials").select("ig_business_id, meta_page_id").eq("client_id", clientId).maybeSingle();

  const results: Array<{ platform: string; contentType: string; ok: boolean; detail: string }> = [];

  for (const platform of platforms) {
    // feed/story/reel only differ on FB & IG — other platforms get one post.
    const typesForPlatform = ["facebook", "instagram"].includes(platform) ? contentTypes : [contentTypes[0]];
    for (const contentType of typesForPlatform) {
      if (viaRecurPost) {
        const accountId = Object.keys(rpMapping).find(
          (id) => rpMapping[id]?.client_id === clientId && rpMapping[id]?.platform === platform
        );
        let ok = false;
        let detail = "";
        if (!accountId) {
          detail = `No RecurPost account mapped for ${client?.name || "this client"} on ${platform} — map it in Social Publisher → RecurPost Accounts.`;
        } else {
          const params: Record<string, unknown> = {
            id: accountId,
            message: caption || title || "",
          };
          if (scheduledFor) params.schedule_date_time = String(scheduledFor).replace("T", " ") + ":00";
          if (mediaIsVideo) params.video_url = mediaUrl;
          else params.image_url = [mediaUrl];
          if (platform === "facebook" && contentType !== "post") params.fb_post_type = contentType;
          if (platform === "instagram") {
            if (contentType !== "post") params.in_post_type = contentType;
            if (contentType === "reel") params.in_reel_share_in_feed = "yes";
          }
          if (platform === "youtube") {
            if (title) params.yt_title = title;
            if (thumbnailUrl) params.yt_thumbnail = thumbnailUrl;
          }
          if (platform === "pinterest" && title) params.pi_title = title;
          try {
            const res = await postContent(params);
            detail = JSON.stringify(res).slice(0, 300);
            const lower = detail.toLowerCase();
            // The call returned 200 — treat as sent unless the body flags an error.
            ok = !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
          } catch (err: unknown) {
            detail = err instanceof Error ? err.message : String(err);
          }
        }
        await admin.from("social_posts").insert({
          client_id: clientId,
          created_by: user.id,
          platform,
          content_type: contentType,
          title: title || null,
          caption: caption || null,
          media_url: mediaUrl,
          thumbnail_url: thumbnailUrl || null,
          scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          status: ok ? "sent" : "failed",
          webhook_response: `[recurpost] ${detail}`,
        });
        results.push({ platform, contentType, ok, detail });
        continue;
      }
      // Payload matches the documented curl operations exactly.
      const payload: Record<string, unknown> = {
        platform,
        content_type: contentType,
        direct: `${platform}-${contentType}`,
        caption: caption || "",
        media_url: mediaUrl,
        scheduled_publish_time: scheduledFor ? new Date(scheduledFor).toISOString() : new Date().toISOString(),
        title: title || "",
        client_name: client?.name || "",
      };
      if (thumbnailUrl) payload.thumbnail_url = thumbnailUrl;
      if (platform === "instagram" && creds?.ig_business_id) payload.page_id_insta = creds.ig_business_id;
      if (platform === "facebook" && creds?.meta_page_id) payload.page_id_fb = creds.meta_page_id;

      let ok = false;
      let detail = "";
      try {
        // webhookUrl is guaranteed here — the RecurPost branch `continue`s above.
        const res = await fetch(webhookUrl as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        detail = `${res.status} ${await res.text().then((t) => t.slice(0, 200)).catch(() => "")}`;
        ok = res.ok;
      } catch (err: unknown) {
        detail = err instanceof Error ? err.message : String(err);
      }

      await admin.from("social_posts").insert({
        client_id: clientId,
        created_by: user.id,
        platform,
        content_type: contentType,
        title: title || null,
        caption: caption || null,
        media_url: mediaUrl,
        thumbnail_url: thumbnailUrl || null,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        status: ok ? "sent" : "failed",
        webhook_response: detail,
      });
      results.push({ platform, contentType, ok, detail });
    }
  }

  const failed = results.filter((r) => !r.ok);

  // If this came from a Content Hub upload and everything sent, mark it handled
  // so it leaves the "received" tray.
  if (uploadId && failed.length === 0) {
    await admin.from("creative_uploads").update({ status: "scheduled" }).eq("id", uploadId);
  }

  return NextResponse.json({ success: failed.length === 0, results });
}
