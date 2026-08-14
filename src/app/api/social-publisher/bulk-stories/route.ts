import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";
import { istWallClockToUtc, utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl } from "@/lib/publishable-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 30 slots × 2 platforms is 60 sequential RecurPost calls — well past the
// default budget.
export const maxDuration = 300;

const MAX_ITEMS = 30;
/** Stories exist only on Meta. Anything else silently became a feed post. */
const STORY_PLATFORMS = ["facebook", "instagram"];

function recurPostIdOf(res: unknown): number | null {
  const id = (res as { post_data?: { id?: unknown } })?.post_data?.id;
  const n = typeof id === "string" ? Number(id) : typeof id === "number" ? id : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/social-publisher/bulk-stories
 *
 * Schedules up to 30 Stories in one go, each at its own IST date+time, to
 * Facebook and/or Instagram. Two shapes feed into the same body: a different
 * creative per slot, or one creative repeated across many slots — by the time
 * it reaches here both are just a list of {mediaUrl, scheduledFor}.
 *
 * Body: { clientId, platforms[], items: [{ mediaUrl, mediaIsVideo?, scheduledFor, uploadId? }] }
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
  const platforms: string[] = Array.isArray(body.platforms) ? body.platforms.filter((p: string) => STORY_PLATFORMS.includes(p)) : [];
  const items: Array<{ mediaUrl: string; mediaIsVideo?: boolean; scheduledFor: string; uploadId?: string }> =
    Array.isArray(body.items) ? body.items : [];

  if (!clientId) return NextResponse.json({ error: "Select a client" }, { status: 400 });
  if (platforms.length === 0) {
    return NextResponse.json({ error: "Select Facebook and/or Instagram — Stories only exist on those two." }, { status: 400 });
  }
  if (items.length === 0) return NextResponse.json({ error: "Add at least one story slot" }, { status: 400 });
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `That is ${items.length} slots — the maximum is ${MAX_ITEMS} per batch.` }, { status: 400 });
  }
  if (items.some((i) => !i.mediaUrl || !i.scheduledFor)) {
    return NextResponse.json({ error: "Every slot needs a creative and a date + time." }, { status: 400 });
  }
  if (!isRecurPostConfigured()) {
    return NextResponse.json({ error: "RecurPost is not configured — add RECURPOST_EMAIL and RECURPOST_API_KEY to the server .env and redeploy." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();

  const accountFor = (platform: string) =>
    Object.keys(rpMapping).find((id) => rpMapping[id]?.client_id === clientId && rpMapping[id]?.platform === platform);

  const missing = platforms.filter((p) => !accountFor(p));
  if (missing.length === platforms.length) {
    return NextResponse.json(
      { error: `No RecurPost account mapped for ${client?.name || "this client"} on ${missing.join(" or ")} — map it in Social Publisher → RecurPost Accounts.` },
      { status: 400 }
    );
  }

  // A Drive link serves a JPEG poster frame for video rather than the video, so
  // mirror to Storage first. "One creative, many times" would otherwise stage
  // the same file 30 times — hence the cache.
  const stagedCache = new Map<string, string>();
  const stageErrors = new Map<string, string>();
  const stageOnce = async (url: string, isVideo: boolean): Promise<string | null> => {
    if (!isVideo) return url;
    if (stagedCache.has(url)) return stagedCache.get(url)!;
    if (stageErrors.has(url)) return null;
    const staged = await toPublishableVideoUrl(url);
    if (!staged.url) {
      stageErrors.set(url, staged.error || "Could not prepare the video for publishing.");
      return null;
    }
    stagedCache.set(url, staged.url);
    return staged.url;
  };

  // Same guard as the single composer: anything already carrying a RecurPost id
  // for this client/media/slot is in their queue, and re-sending adds a copy
  // rather than replacing one — their API has no cancel.
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: alreadySent } = await admin
    .from("social_posts")
    .select("platform, media_url, scheduled_for")
    .eq("client_id", clientId)
    .eq("content_type", "story")
    .not("recurpost_post_id", "is", null)
    .gte("created_at", sinceIso);
  const alreadyKey = new Set(
    (alreadySent || []).map((p) => `${p.platform}|${p.media_url}|${p.scheduled_for ?? ""}`)
  );

  const results: Array<{ slot: number; platform: string; scheduledFor: string; ok: boolean; detail: string }> = [];
  const skipped: string[] = [];
  const doneUploadIds = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const isVideo = !!item.mediaIsVideo || /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(item.mediaUrl);
    const scheduledUtc = istWallClockToUtc(item.scheduledFor);
    const scheduledIso = scheduledUtc.toISOString();

    const publishUrl = await stageOnce(item.mediaUrl, isVideo);
    if (!publishUrl) {
      for (const platform of platforms) {
        results.push({ slot: idx + 1, platform, scheduledFor: item.scheduledFor, ok: false, detail: stageErrors.get(item.mediaUrl) || "Could not prepare the media." });
      }
      continue;
    }

    let slotAllOk = true;

    for (const platform of platforms) {
      if (alreadyKey.has(`${platform}|${publishUrl}|${scheduledIso}`)) {
        skipped.push(`Slot ${idx + 1} ${platform} — already queued for that time.`);
        continue;
      }

      const accountId = accountFor(platform);
      let ok = false;
      let detail = "";
      let rpId: number | null = null;

      if (!accountId) {
        detail = `No RecurPost account mapped for ${client?.name || "this client"} on ${platform}.`;
      } else {
        const params: Record<string, unknown> = {
          id: accountId,
          // Stories carry no caption on either platform — the text is dropped.
          message: "",
          // RecurPost schedules in the account's own (IST) clock, so send IST
          // wall clock rather than the UTC instant.
          schedule_date_time: utcToIstWallClock(scheduledUtc),
        };
        if (isVideo) params.video_url = publishUrl;
        else params.image_url = [publishUrl];
        if (platform === "facebook") params.fb_post_type = "story";
        if (platform === "instagram") params.in_post_type = "story";

        try {
          const res = await postContent(params);
          detail = JSON.stringify(res).slice(0, 300);
          const lower = detail.toLowerCase();
          // An id back means RecurPost queued it, whatever else the body says.
          // Recording an accepted post as failed is what invites the duplicate.
          rpId = recurPostIdOf(res);
          ok = rpId !== null || !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
        } catch (err: unknown) {
          detail = err instanceof Error ? err.message : String(err);
        }
      }

      if (ok) alreadyKey.add(`${platform}|${publishUrl}|${scheduledIso}`);
      else slotAllOk = false;

      await admin.from("social_posts").insert({
        client_id: clientId,
        created_by: user.id,
        platform,
        content_type: "story",
        title: null,
        caption: null,
        media_url: publishUrl,
        media_is_video: isVideo,
        thumbnail_url: null,
        scheduled_for: scheduledIso,
        status: ok ? "sent" : "failed",
        recurpost_post_id: rpId,
        webhook_response: `[recurpost bulk-story] ${detail}`,
      });

      results.push({ slot: idx + 1, platform, scheduledFor: item.scheduledFor, ok, detail });
    }

    if (slotAllOk && item.uploadId) doneUploadIds.add(item.uploadId);
  }

  // Retire the Content Hub items that went out cleanly so they leave the tray.
  if (doneUploadIds.size > 0) {
    await admin.from("creative_uploads").update({ status: "scheduled" }).in("id", Array.from(doneUploadIds));
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    success: failed.length === 0,
    sent: results.length - failed.length,
    failed: failed.length,
    results,
    skipped,
  });
}
