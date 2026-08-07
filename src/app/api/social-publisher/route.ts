import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";
import { istWallClockToUtc, utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl } from "@/lib/publishable-media";

export const dynamic = "force-dynamic";

// GET — post history (newest first).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("social_posts")
    .select("*, clients(name), profiles:created_by(name, avatar_url, designation)")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, posts: data || [] });
}

// POST — publish/schedule via RecurPost (one call per platform × content type).
// Body: { clientId, platforms[], contentTypes[], title, caption, mediaUrl,
//         mediaIsVideo?, thumbnailUrl?, scheduledFor, uploadId? }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // --- Retry a failed post from the Library -------------------------------
  if (body.action === "retry" && body.id) {
    if (!isRecurPostConfigured()) {
      return NextResponse.json({ error: "RecurPost is not configured." }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    const { data: post } = await admin.from("social_posts").select("*").eq("id", body.id).single();
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
    const map = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
    const accountId = Object.keys(map).find((k) => map[k]?.client_id === post.client_id && map[k]?.platform === post.platform);
    if (!accountId) {
      return NextResponse.json({ error: `No RecurPost account mapped for this client on ${post.platform}.` }, { status: 400 });
    }

    // media_is_video is what the composer actually knew at send time — trust it
    // when present. Older rows (before this column existed) fall back to the
    // URL's extension, which is wrong for extension-less Drive links.
    const isVideo = post.media_is_video ?? /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(post.media_url as string);
    if (post.content_type === "reel" && !isVideo) {
      return NextResponse.json({ error: "This was sent as an image tagged Reel — Meta rejects that. Fix it in Content Hub or Social Publisher and send it as a new post rather than retrying." }, { status: 400 });
    }
    const params: Record<string, unknown> = { id: accountId, message: post.caption || post.title || "" };
    if (post.scheduled_for && new Date(post.scheduled_for as string).getTime() > Date.now()) {
      // RecurPost schedules in the account's own (IST) clock, so send IST —
      // not the UTC instant, which would retry the post 5:30 early.
      params.schedule_date_time = utcToIstWallClock(post.scheduled_for as string);
    }
    let retryUrl = post.media_url as string;
    if (isVideo) {
      const staged = await toPublishableVideoUrl(retryUrl);
      if (!staged.url) return NextResponse.json({ error: staged.error || "Could not prepare the video for publishing." }, { status: 502 });
      retryUrl = staged.url;
    }
    if (isVideo) params.video_url = retryUrl;
    else params.image_url = [retryUrl];
    if (post.platform === "facebook" && post.content_type !== "post") params.fb_post_type = post.content_type;
    if (post.platform === "instagram") {
      if (post.content_type !== "post") params.in_post_type = post.content_type;
      if (post.content_type === "reel") params.in_reel_share_in_feed = "yes";
    }
    if (post.platform === "youtube") {
      if (post.title) params.yt_title = post.title;
      if (post.thumbnail_url) params.yt_thumbnail = post.thumbnail_url;
    }
    if (post.platform === "pinterest" && post.title) params.pi_title = post.title;

    let ok = false;
    let detail = "";
    try {
      const res = await postContent(params);
      detail = JSON.stringify(res).slice(0, 300);
      const lower = detail.toLowerCase();
      ok = !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
    } catch (err: unknown) {
      detail = err instanceof Error ? err.message : String(err);
    }
    await admin.from("social_posts").update({ status: ok ? "sent" : "failed", webhook_response: `[retry] ${detail}` }).eq("id", body.id);
    return NextResponse.json({ success: ok, detail }, { status: ok ? 200 : 500 });
  }

  const { clientId, platforms, title, caption, mediaUrl, thumbnailUrl, scheduledFor, uploadId, thumbUploadId } = body;
  const contentTypes: string[] = Array.isArray(body.contentTypes) ? body.contentTypes : body.contentType ? [body.contentType] : [];
  if (!clientId) return NextResponse.json({ error: "Select a client" }, { status: 400 });
  if (!Array.isArray(platforms) || platforms.length === 0) return NextResponse.json({ error: "Select at least one platform" }, { status: 400 });
  if (!mediaUrl) return NextResponse.json({ error: "Upload or pick the media first" }, { status: 400 });
  if (contentTypes.length === 0 || contentTypes.some((t) => !["post", "reel", "story"].includes(t))) {
    return NextResponse.json({ error: "Select 1–2 valid content types" }, { status: 400 });
  }
  const mediaIsVideo = !!body.mediaIsVideo || /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(mediaUrl);
  // Meta rejects a Reel that isn't an actual video — catch it here instead of
  // letting RecurPost bounce it back as an opaque "URL is not a video" 415.
  if (contentTypes.includes("reel") && !mediaIsVideo) {
    return NextResponse.json({ error: "Reel needs an actual video — the media given is an image. Upload a video, or drop Reel from the content types." }, { status: 400 });
  }
  if (!isRecurPostConfigured()) {
    return NextResponse.json({ error: "RecurPost is not configured — add RECURPOST_EMAIL and RECURPOST_API_KEY to the server .env and redeploy." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};

  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();

  // A Drive link serves a JPEG poster frame for video, never the video itself,
  // so mirror it to Storage first (no-op for anything already publishable).
  let publishUrl = mediaUrl;
  if (mediaIsVideo) {
    const staged = await toPublishableVideoUrl(mediaUrl);
    if (!staged.url) return NextResponse.json({ error: staged.error || "Could not prepare the video for publishing." }, { status: 502 });
    publishUrl = staged.url;
  }

  // Guard against sending the same post twice. When one platform in a batch
  // fails (YouTube rejecting an image, say), the natural reaction is to hit
  // Send again — which re-posted to the platforms that had ALREADY succeeded.
  // That is how Taraash ended up on the calendar three times.
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let alreadyQ = admin
    .from("social_posts")
    .select("platform, content_type, scheduled_for")
    .eq("client_id", clientId)
    .eq("media_url", publishUrl)
    .eq("status", "sent")
    .gte("created_at", sinceIso);
  const scheduledIso = scheduledFor ? istWallClockToUtc(scheduledFor).toISOString() : null;
  alreadyQ = scheduledIso ? alreadyQ.eq("scheduled_for", scheduledIso) : alreadyQ.is("scheduled_for", null);
  const { data: alreadySent } = await alreadyQ;
  const alreadyKey = new Set((alreadySent || []).map((p) => `${p.platform}|${p.content_type}`));

  const results: Array<{ platform: string; contentType: string; ok: boolean; detail: string }> = [];

  // YouTube is video-only — an image post there always comes back 3003. The
  // client's platforms are pre-selected from their RecurPost mapping, so
  // YouTube arrives ticked by default on photo posts. Drop it and say so,
  // rather than letting it fail and sit in the Library as an error.
  const skipped: string[] = [];
  let targetPlatforms: string[] = platforms;
  if (!mediaIsVideo && platforms.includes("youtube")) {
    targetPlatforms = platforms.filter((p) => p !== "youtube");
    skipped.push("YouTube — it only accepts video, and this post is an image.");
  }
  if (targetPlatforms.length === 0) {
    return NextResponse.json({ error: "YouTube only accepts video. Upload a video, or pick another platform." }, { status: 400 });
  }

  for (const platform of targetPlatforms) {
    // feed/story/reel only differ on FB & IG — other platforms get one post.
    const typesForPlatform = ["facebook", "instagram"].includes(platform) ? contentTypes : [contentTypes[0]];
    for (const contentType of typesForPlatform) {
      const accountId = Object.keys(rpMapping).find(
        (id) => rpMapping[id]?.client_id === clientId && rpMapping[id]?.platform === platform
      );
      let ok = false;
      let detail = "";
      if (alreadyKey.has(`${platform}|${contentType}`)) {
        // Same client, same media, same slot, already away — don't post twice.
        skipped.push(`${platform} ${contentType} — already posted.`);
        continue;
      }
      if (!accountId) {
        detail = `No RecurPost account mapped for ${client?.name || "this client"} on ${platform} — map it in Social Publisher → RecurPost Accounts.`;
      } else {
        const params: Record<string, unknown> = {
          id: accountId,
          message: caption || title || "",
        };
        // The composer's date/time pickers are already IST wall clock — which is
        // exactly what RecurPost expects, so pass it through.
        if (scheduledFor) params.schedule_date_time = utcToIstWallClock(istWallClockToUtc(scheduledFor));
        if (mediaIsVideo) params.video_url = publishUrl;
        else params.image_url = [publishUrl];
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
        // Record what was actually sent, not the Drive original — so the
        // Library preview and any retry use the same fetchable URL.
        media_url: publishUrl,
        media_is_video: mediaIsVideo,
        thumbnail_url: thumbnailUrl || null,
        scheduled_for: scheduledFor ? istWallClockToUtc(scheduledFor).toISOString() : null,
        status: ok ? "sent" : "failed",
        webhook_response: `[recurpost] ${detail}`,
      });
      results.push({ platform, contentType, ok, detail });
    }
  }

  const failed = results.filter((r) => !r.ok);

  // If this came from a Content Hub upload and everything sent, mark it handled
  // so it leaves the "received" tray.
  // The thumbnail comes from its own Content Hub section (designers upload covers
  // separately from the editors' reels) — retire it with the reel it was used on.
  if (failed.length === 0) {
    const usedIds = [uploadId, thumbUploadId].filter(Boolean) as string[];
    if (usedIds.length > 0) {
      await admin.from("creative_uploads").update({ status: "scheduled" }).in("id", usedIds);
    }
  }

  // A deliberate skip is not a failure — don't report the whole send as failed.
  return NextResponse.json({ success: failed.length === 0, results, skipped });
}

// DELETE — remove a post from the Library. Note: RecurPost's API has no cancel
// endpoint, so this only clears our record; a future-scheduled post must also be
// cancelled inside RecurPost itself.
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  const ids: string[] = Array.isArray(body.ids) && body.ids.length ? body.ids : body.id ? [body.id] : [];
  if (ids.length === 0) return NextResponse.json({ error: "id or ids required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("social_posts").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deleted: ids.length });
}
