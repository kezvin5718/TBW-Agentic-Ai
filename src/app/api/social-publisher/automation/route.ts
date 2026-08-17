import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";
import { istWallClockToUtc, utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl } from "@/lib/publishable-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A month of creatives across two platforms is a long run of sequential calls.
export const maxDuration = 300;

function recurPostIdOf(res: unknown): number | null {
  const id = (res as { post_data?: { id?: unknown } })?.post_data?.id;
  const n = typeof id === "string" ? Number(id) : typeof id === "number" ? id : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/social-publisher/automation?clientId=…
 *
 * Everything approved and waiting for this client, captions already written.
 *
 * Only clean work appears: a creative whose batch failed QC is rejected and
 * excluded, because the whole point is that the team opens this screen and
 * finds nothing left to check.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("creative_uploads")
    .select("id, file_url, file_name, media_type, content_type, caption, caption_status, qc_status, qc_note, thumbnail_url, created_at")
    .eq("client_id", clientId)
    .eq("status", "uploaded")
    .eq("qc_status", "match")
    .is("festival_id", null)
    .neq("content_type", "thumbnail")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Which platforms this client can actually receive a post on.
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
  const platforms = Array.from(
    new Set(Object.values(rpMapping).filter((m) => m?.client_id === clientId).map((m) => m.platform).filter(Boolean))
  );

  // Held back for a fix rather than silently missing from the list.
  const { count: rejected } = await admin
    .from("creative_uploads")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "rejected");

  const rows = data || [];
  return NextResponse.json({
    success: true,
    uploads: rows,
    platforms,
    rejected: rejected || 0,
    awaitingCaption: rows.filter((r) => r.caption_status !== "done" && !String(r.caption || "").trim()).length,
  });
}

/**
 * POST /api/social-publisher/automation
 * Body: { clientId, platforms[], items: [{ uploadId, caption, scheduledFor }] }
 *
 * Schedules the whole list in one go and retires each creative from the hub.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { clientId } = body;

  // Write the captions that are missing.
  //
  // Captions are normally written as QC passes, but that only ever runs over
  // rows still marked pending — so anything approved before the feature existed,
  // or whose caption failed once, was stuck with no way back. This is that way
  // back, and it is deliberately a button rather than something the screen does
  // on load: it is a vision read and a caption per creative, and fifty of them
  // is not something to start by accident.
  if (body.action === "captions") {
    if (!clientId) return NextResponse.json({ error: "Select a client" }, { status: 400 });
    const admin2 = createServiceRoleClient();
    const { data: pending } = await admin2
      .from("creative_uploads")
      .select("id, caption, caption_status")
      .eq("client_id", clientId)
      .eq("status", "uploaded")
      .eq("qc_status", "match")
      .is("festival_id", null)
      .neq("content_type", "thumbnail")
      .neq("content_type", "story")
      .order("created_at", { ascending: true })
      .limit(Number(body.limit) || 15);

    const todo = (pending || []).filter((r) => !String(r.caption || "").trim());
    if (todo.length === 0) return NextResponse.json({ success: true, written: 0, remaining: 0, message: "Every creative already has a caption." });

    const { writeCaptionFor } = await import("@/lib/upload-batch");
    const origin = request.nextUrl.origin;
    const cookie = request.headers.get("cookie") || "";
    let written = 0;
    const problems: string[] = [];
    for (const r of todo) {
      // A failed attempt has to be allowed another go, or the row stays empty
      // for good.
      if (r.caption_status === "failed" || r.caption_status === "no_contact") {
        await admin2.from("creative_uploads").update({ caption_status: "none" }).eq("id", r.id);
      }
      if (await writeCaptionFor(r.id, origin, cookie)) written++;
      else problems.push(r.id);
    }

    const { count: stillEmpty } = await admin2
      .from("creative_uploads")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "uploaded")
      .eq("qc_status", "match")
      .is("festival_id", null)
      .or("caption.is.null,caption.eq.");

    return NextResponse.json({
      success: true,
      written,
      failed: problems.length,
      remaining: Math.max(0, (stillEmpty || 0)),
      message: `${written} caption(s) written${problems.length ? `, ${problems.length} could not be` : ""}.`,
    });
  }

  const platforms: string[] = Array.isArray(body.platforms) ? body.platforms.filter(Boolean) : [];
  const items: Array<{ uploadId: string; caption?: string; scheduledFor: string }> = Array.isArray(body.items) ? body.items : [];

  if (!clientId) return NextResponse.json({ error: "Select a client" }, { status: 400 });
  if (platforms.length === 0) return NextResponse.json({ error: "Select at least one platform" }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: "Nothing to schedule" }, { status: 400 });
  if (items.some((i) => !i.uploadId || !i.scheduledFor)) {
    return NextResponse.json({ error: "Every row needs a date and a time." }, { status: 400 });
  }
  if (!isRecurPostConfigured()) {
    return NextResponse.json({ error: "RecurPost is not configured — add RECURPOST_EMAIL and RECURPOST_API_KEY and redeploy." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
  const accountFor = (platform: string) =>
    Object.keys(rpMapping).find((id) => rpMapping[id]?.client_id === clientId && rpMapping[id]?.platform === platform);

  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();

  const ids = items.map((i) => i.uploadId);
  const { data: uploads } = await admin
    .from("creative_uploads")
    .select("id, file_url, media_type, content_type, status, qc_status, thumbnail_url")
    .in("id", ids);
  const byId = new Map((uploads || []).map((u) => [u.id, u]));

  const results: Array<{ uploadId: string; platform: string; ok: boolean; detail: string }> = [];
  const skipped: string[] = [];
  const doneUploads = new Set<string>();
  const stagedCache = new Map<string, string>();

  for (const item of items) {
    const upload = byId.get(item.uploadId);
    if (!upload) { skipped.push(`${item.uploadId} — no longer in the hub.`); continue; }
    // Re-checked at send time: a batch can be rejected between loading the
    // screen and pressing the button, and rejected work must never go out.
    if (upload.status !== "uploaded" || upload.qc_status !== "match") {
      skipped.push(`${upload.id} — no longer approved (${upload.status}/${upload.qc_status}).`);
      continue;
    }

    const isVideo = upload.media_type === "video";
    let publishUrl = upload.file_url as string;
    if (isVideo) {
      if (stagedCache.has(publishUrl)) publishUrl = stagedCache.get(publishUrl)!;
      else {
        const staged = await toPublishableVideoUrl(publishUrl);
        if (!staged.url) {
          results.push({ uploadId: upload.id, platform: "-", ok: false, detail: staged.error || "Could not prepare the video." });
          continue;
        }
        stagedCache.set(upload.file_url as string, staged.url);
        publishUrl = staged.url;
      }
    }

    const scheduledUtc = istWallClockToUtc(item.scheduledFor);
    const scheduledIso = scheduledUtc.toISOString();
    const contentType = upload.content_type || "post";
    let allOk = true;

    for (const platform of platforms) {
      const accountId = accountFor(platform);
      let ok = false;
      let detail = "";
      let rpId: number | null = null;

      if (!accountId) {
        detail = `No RecurPost account mapped for ${client?.name || "this client"} on ${platform}.`;
      } else {
        const params: Record<string, unknown> = {
          id: accountId,
          // A Story drops the text, but RecurPost rejects an empty message
          // outright — so it always carries something.
          message: contentType === "story" ? (client?.name || "Story") : (item.caption || client?.name || ""),
          schedule_date_time: utcToIstWallClock(scheduledUtc),
        };
        if (isVideo) params.video_url = publishUrl;
        else params.image_url = [publishUrl];
        if (platform === "facebook" && contentType !== "post") params.fb_post_type = contentType;
        if (platform === "instagram" && contentType !== "post") params.in_post_type = contentType;
        if (platform === "instagram" && contentType === "reel") params.in_reel_share_in_feed = "yes";
        if (isVideo && upload.thumbnail_url) {
          if (platform === "facebook") params.fb_thumb = upload.thumbnail_url;
          if (platform === "instagram") params.in_thumb = upload.thumbnail_url;
        }

        try {
          const res = await postContent(params);
          detail = JSON.stringify(res).slice(0, 300);
          const lower = detail.toLowerCase();
          rpId = recurPostIdOf(res);
          ok = rpId !== null || !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
        } catch (err: unknown) {
          detail = err instanceof Error ? err.message : String(err);
        }
        if (!ok) console.error(`automation ${upload.id} ${platform} rejected: ${detail} · sent ${JSON.stringify({ ...params, id: "<account>" }).slice(0, 260)}`);
      }

      await admin.from("social_posts").insert({
        client_id: clientId,
        created_by: user.id,
        platform,
        content_type: contentType,
        title: null,
        caption: contentType === "story" ? null : (item.caption || null),
        media_url: publishUrl,
        media_is_video: isVideo,
        thumbnail_url: upload.thumbnail_url || null,
        scheduled_for: scheduledIso,
        status: ok ? "sent" : "failed",
        recurpost_post_id: rpId,
        webhook_response: `[automation] ${detail}`,
      });

      results.push({ uploadId: upload.id, platform, ok, detail });
      if (!ok) allOk = false;
    }

    if (allOk) doneUploads.add(upload.id);
  }

  // Only creatives that went out cleanly leave the hub; a partial failure stays
  // put so the row can be retried rather than quietly disappearing.
  if (doneUploads.size > 0) {
    await admin.from("creative_uploads").update({ status: "scheduled" }).in("id", Array.from(doneUploads));
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    success: failed.length === 0,
    scheduled: doneUploads.size,
    posts: results.length - failed.length,
    failed: failed.length,
    results,
    skipped,
  });
}
