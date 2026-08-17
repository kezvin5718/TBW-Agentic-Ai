import { createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";
import { utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl } from "@/lib/publishable-media";

/** Stories exist only on Meta. Nothing else can carry one. */
const STORY_PLATFORMS = ["facebook", "instagram"];

function recurPostIdOf(res: unknown): number | null {
  const id = (res as { post_data?: { id?: unknown } })?.post_data?.id;
  const n = typeof id === "string" ? Number(id) : typeof id === "number" ? id : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface FestivalScheduleResult {
  scheduled: number;
  failed: number;
  blocked: boolean;
  notes: string[];
}

/**
 * Schedules one festival creative as a Story, once its QC has passed.
 *
 * A festival story never passes through the composer: the festival fixes the
 * time, the creative carries its own message, and Stories drop captions on both
 * platforms anyway. Upload it and it is handled — it appears in the Library as
 * a scheduled post, and nowhere in the Social Publisher tray.
 *
 * QC is a gate, not a label. A creative that failed is not scheduled at all,
 * because the mistake this catches — a Diwali greeting going out on Holi, or
 * one client's artwork under another's name — is not one you can take back
 * after it publishes.
 */
export async function scheduleFestivalStory(uploadId: string): Promise<FestivalScheduleResult> {
  const admin = createServiceRoleClient();
  const notes: string[] = [];

  const { data: upload } = await admin
    .from("creative_uploads")
    .select("id, client_id, file_url, file_name, media_type, qc_status, status, festival_id, festivals(name, scheduled_at), clients(name)")
    .eq("id", uploadId)
    .maybeSingle();

  if (!upload) return { scheduled: 0, failed: 0, blocked: true, notes: ["That upload no longer exists."] };
  if (!upload.festival_id) return { scheduled: 0, failed: 0, blocked: true, notes: ["This upload has no festival on it."] };

  const festival = upload.festivals as { name?: string; scheduled_at?: string } | null;
  const clientName = (upload.clients as { name?: string } | null)?.name || "this client";

  // The gate. "unsure" is not a pass — no festival cue found on a creative
  // filed as a festival story is exactly the case a human should look at.
  if (upload.qc_status !== "match") {
    return {
      scheduled: 0,
      failed: 0,
      blocked: true,
      notes: [
        upload.qc_status === "mismatch"
          ? `QC failed for ${clientName} — not scheduled. Fix the creative and upload it again.`
          : `QC hasn't passed this yet (${upload.qc_status || "pending"}) — not scheduled.`,
      ],
    };
  }

  if (!festival?.scheduled_at) {
    return { scheduled: 0, failed: 0, blocked: true, notes: ["That festival has no time set — set one on the Festivals page."] };
  }
  if (!isRecurPostConfigured()) {
    return { scheduled: 0, failed: 0, blocked: true, notes: ["RecurPost is not configured, so nothing could be scheduled."] };
  }

  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
  const accountFor = (platform: string) =>
    Object.keys(rpMapping).find((id) => rpMapping[id]?.client_id === upload.client_id && rpMapping[id]?.platform === platform);

  const platforms = STORY_PLATFORMS.filter((p) => accountFor(p));
  if (platforms.length === 0) {
    return {
      scheduled: 0,
      failed: 0,
      blocked: true,
      notes: [`${clientName} has no Facebook or Instagram account mapped in RecurPost, so this could not be scheduled.`],
    };
  }

  const isVideo = upload.media_type === "video";
  let publishUrl = upload.file_url as string;
  if (isVideo) {
    // A Drive link serves a poster frame for video, never the video itself.
    const staged = await toPublishableVideoUrl(publishUrl);
    if (!staged.url) return { scheduled: 0, failed: 0, blocked: true, notes: [staged.error || "Could not prepare the video for publishing."] };
    publishUrl = staged.url;
  }

  const when = new Date(festival.scheduled_at);
  const scheduledIso = when.toISOString();

  // Re-running QC or double-clicking must not queue the same story twice —
  // RecurPost has no cancel, so a duplicate has to be removed there by hand.
  const { data: already } = await admin
    .from("social_posts")
    .select("platform")
    .eq("client_id", upload.client_id)
    .eq("media_url", publishUrl)
    .eq("content_type", "story")
    .eq("scheduled_for", scheduledIso)
    .not("recurpost_post_id", "is", null);
  const done = new Set((already || []).map((p) => p.platform));

  let scheduled = 0;
  let failed = 0;

  for (const platform of platforms) {
    if (done.has(platform)) {
      notes.push(`${platform} — already queued for ${festival.name}.`);
      continue;
    }

    const params: Record<string, unknown> = {
      id: accountFor(platform)!,
      // Stories carry no caption on either platform; the creative is the message.
      message: "",
      schedule_date_time: utcToIstWallClock(when),
    };
    if (isVideo) params.video_url = publishUrl;
    else params.image_url = [publishUrl];
    if (platform === "facebook") params.fb_post_type = "story";
    if (platform === "instagram") params.in_post_type = "story";

    let ok = false;
    let detail = "";
    let rpId: number | null = null;
    try {
      const res = await postContent(params);
      detail = JSON.stringify(res).slice(0, 300);
      const lower = detail.toLowerCase();
      rpId = recurPostIdOf(res);
      ok = rpId !== null || !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
    } catch (err: unknown) {
      detail = err instanceof Error ? err.message : String(err);
    }

    await admin.from("social_posts").insert({
      client_id: upload.client_id,
      platform,
      content_type: "story",
      title: festival.name || null,
      caption: null,
      media_url: publishUrl,
      media_is_video: isVideo,
      scheduled_for: scheduledIso,
      status: ok ? "sent" : "failed",
      recurpost_post_id: rpId,
      webhook_response: `[festival-story: ${festival.name}] ${detail}`,
    });

    if (ok) scheduled++;
    else {
      failed++;
      notes.push(`${platform} — could not be scheduled: ${detail.slice(0, 140)}`);
    }
  }

  if (scheduled > 0) {
    // Out of the Content Hub tray: this one is handled, not waiting for anyone.
    await admin.from("creative_uploads").update({ status: "scheduled" }).eq("id", uploadId);
  }

  return { scheduled, failed, blocked: false, notes };
}
