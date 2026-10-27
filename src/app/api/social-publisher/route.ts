import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured } from "@/lib/recurpost";
import { istWallClockToUtc, utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl, toPublishableThumbUrl } from "@/lib/publishable-media";
import { reserve, reclaim, settle, sendToRecurPost, IN_FLIGHT } from "@/lib/post-dedupe";

export const dynamic = "force-dynamic";

// RecurPost's post id (post_data.id) is the only handle on a queued post —
// what the team types into RecurPost's Queue to remove one. Reading it, and
// reading the whole answer, now lives in post-dedupe beside the reservation
// that guards every send.

/**
 * RecurPost reports a refused post as HTTP 200 with a one-line body that names
 * no field. Carry the platform's known causes alongside it so the team reads a
 * next step instead of "Something went wrong in posting."
 */
function explainFailure(platform: string, detail: string): string {
  if (!/something went wrong/i.test(detail)) return detail;
  if (platform === "pinterest") {
    return `${detail} — Pinterest refused it without naming a reason. Usual causes: the Pinterest account in RecurPost has no board selected (open RecurPost → Pinterest account → set a default board), the pin image is too large or an unsupported ratio, or the account needs reconnecting.`;
  }
  return detail;
}

/**
 * A Pinterest pin always carries a title.
 *
 * Video pins are accepted without one, which is why this went unnoticed for
 * weeks — every Pinterest post that ever succeeded here was a video. The first
 * two image pins both came back "Something went wrong in posting.", a generic
 * body that names no field, with a 200 status. Rather than make the social team
 * remember which platform needs which box filled, derive a title from the
 * caption when they leave it blank: the first line is the hook the writer
 * already composed, and Pinterest caps titles at 100 characters.
 */
function pinterestTitle(title?: string | null, caption?: string | null): string {
  const typed = String(title || "").trim();
  if (typed) return typed.slice(0, 100);
  const firstLine = String(caption || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine || "New pin").slice(0, 100);
}

// GET — post history (newest first).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const SELECT = "*, clients(name), profiles:created_by(name, avatar_url, designation)";
  const { data, error } = await supabase
    .from("social_posts")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Every duplicate still waiting to be removed in RecurPost, however old.
  // The Library only reads the newest 60, and a copy flagged last month is
  // still publishing if nobody deleted it — it has to stay in front of the
  // team until someone marks it removed or not a duplicate.
  const { data: flagged } = await supabase
    .from("social_posts")
    .select(SELECT)
    .eq("duplicate_resolution_status", "manual_removal_required")
    .order("created_at", { ascending: false })
    .limit(200);
  const seen = new Set((data || []).map((p) => p.id));
  const posts = [...(data || []), ...(flagged || []).filter((p) => !seen.has(p.id))];
  return NextResponse.json({ success: true, posts });
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
    const { data: post } = await admin.from("social_posts").select("*, clients(name)").eq("id", body.id).single();
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    // Somebody is sending this very row right now. A second press is the
    // duplicate, so it is told so and nothing is called.
    if (post.status === "sending") {
      return NextResponse.json({ error: `${IN_FLIGHT} — this post is being sent right now.`, duplicate: true }, { status: 409 });
    }

    // RecurPost never answered this one clearly, so it may well be sitting in
    // their queue already. Nobody resends it blind: the team looks first, and
    // says so, and only then does it go again — on this same row.
    const confirmedUncertain = post.status === "uncertain" && body.confirmedUncertain === true;
    if (post.status === "uncertain" && !confirmedUncertain) {
      return NextResponse.json(
        {
          error: "RecurPost may already have this. Check its Queue; resend only if it is not there.",
          needsConfirmation: true,
          uncertain: true,
          recurpostPostId: post.recurpost_post_id ?? null,
        },
        { status: 409 }
      );
    }

    // A RecurPost id means they accepted this post and it is sitting in their
    // queue — whatever our own status column says. Sending it again adds a
    // second copy rather than replacing the first, because their API has no
    // cancel. That is the duplicate: not two clicks of Send, but a retry on a
    // post RecurPost had already taken. (Confirming an uncertain row is the
    // same promise — "I looked, it is not there" — so it answers this too.)
    if (post.recurpost_post_id && !body.confirmedRemoved && !confirmedUncertain) {
      return NextResponse.json(
        {
          error: `RecurPost already has this queued as post ${post.recurpost_post_id}. Retrying adds a second copy — their API cannot replace one. Delete post ${post.recurpost_post_id} in RecurPost → Queue first, then retry.`,
          needsConfirmation: true,
          recurpostPostId: post.recurpost_post_id,
        },
        { status: 409 }
      );
    }

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

    // A carousel retry must carry ALL its slides, not the cover this row
    // happens to hold — and never the in/fb post-type override, which only
    // confuses RecurPost about what is already a plain multi-image post. The
    // slides are found through the hub row whose cover this is.
    let carouselSlides: string[] | null = null;
    if (post.content_type === "carousel") {
      if (!["instagram", "facebook"].includes(post.platform as string)) {
        return NextResponse.json({ error: "Carousels are Instagram/Facebook only — this row cannot be retried." }, { status: 400 });
      }
      const { data: hubRow } = await admin
        .from("creative_uploads")
        .select("id")
        .eq("content_type", "carousel")
        .eq("file_url", post.media_url)
        .maybeSingle();
      const { data: slides } = hubRow
        ? await admin.from("carousel_slides").select("file_url").eq("upload_id", hubRow.id).order("slide_no")
        : { data: null };
      if (!slides || slides.length === 0) {
        return NextResponse.json({ error: "This carousel's slides are no longer in the hub, so a retry would post only the cover. Rebuild the carousel in Content Hub and send it fresh from Automation." }, { status: 400 });
      }
      carouselSlides = slides.map((s) => s.file_url as string);
    }
    // RecurPost refuses an empty message ("Bad Request Please try again
    // later") even on a Story, whose text the platforms drop anyway — so a
    // story retry carries the client's name, exactly as the first send did.
    const clientName = (post.clients as { name?: string } | null)?.name || "";
    const params: Record<string, unknown> = {
      id: accountId,
      message: post.caption || post.title || (post.content_type === "story" ? clientName || "Story" : ""),
    };
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
    else params.image_url = carouselSlides ?? [retryUrl];
    // A print-resolution cover is re-encoded by the platform and arrives soft;
    // hand over one already cut to the shape and size the format shows.
    let retryThumb = post.thumbnail_url as string | null;
    if (isVideo && retryThumb) {
      retryThumb = (await toPublishableThumbUrl(retryThumb)).url;
    }
    if (post.platform === "facebook") {
      if (post.content_type !== "post" && post.content_type !== "carousel") params.fb_post_type = post.content_type;
      if (isVideo && retryThumb) params.fb_thumb = retryThumb;
    }
    if (post.platform === "instagram") {
      if (post.content_type !== "post" && post.content_type !== "carousel") params.in_post_type = post.content_type;
      if (post.content_type === "reel") params.in_reel_share_in_feed = "yes";
      if (isVideo && retryThumb) params.in_thumb = retryThumb;
    }
    if (post.platform === "linkedin" && isVideo && retryThumb) params.ln_thumb = retryThumb;
    if (post.platform === "youtube") {
      if (post.title) params.yt_title = post.title;
      // RecurPost calls this yt_thumb. We sent yt_thumbnail for months and it
      // was silently ignored, which is why no thumbnail ever appeared.
      if (retryThumb) params.yt_thumb = retryThumb;
    }
    if (post.platform === "pinterest") params.pi_title = pinterestTitle(post.title, post.caption);

    // Claim this same row before calling RecurPost — never a new one. An
    // uncertain row keeps the key it already holds; any other retry is keyed
    // on what is actually being sent now (its slot if still ahead, "now"
    // otherwise), so a live copy of exactly that is refused by the index.
    const future = !!params.schedule_date_time;
    const claim = await reclaim(
      admin,
      post.id as string,
      post.status as string,
      {
        clientId: post.client_id as string,
        accountId,
        platform: post.platform as string,
        contentType: post.content_type as string,
        mediaUrl: post.media_url as string,
        scheduledIso: future ? new Date(post.scheduled_for as string).toISOString() : null,
      },
      post.status === "uncertain" ? ((post.dedupe_key as string | null) ?? null) : null
    );
    if (claim.kind === "duplicate") {
      return NextResponse.json({ error: claim.message, duplicate: true, alreadyOut: claim.alreadyOut }, { status: 409 });
    }
    if (claim.kind === "error") return NextResponse.json({ error: claim.message }, { status: 500 });

    // An id coming back means RecurPost queued it, and that is the truth
    // regardless of any other wording in the body. Recording an accepted post
    // as "failed" is what invites the retry that duplicates it.
    const outcome = await sendToRecurPost(params);
    const ok = outcome.status === "sent";
    const detail = explainFailure(post.platform, outcome.detail);
    await settle(admin, claim.id, outcome, `[retry] ${detail}`, outcome.rpId !== null ? { needs_recurpost_cleanup: false } : {});
    return NextResponse.json(
      { success: ok, detail, recurpostPostId: outcome.rpId, uncertain: outcome.status === "uncertain" },
      { status: ok ? 200 : outcome.status === "uncertain" ? 502 : 500 }
    );
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
  // RecurPost requires a description on posts and reels, and when it gets an
  // empty one it answers only "Bad Request Please try again later" — which is
  // how the 10 Oct Shri reel burned six sends. Only a Story is captionless.
  if (contentTypes.some((t) => t !== "story") && !String(caption || "").trim() && !String(title || "").trim()) {
    return NextResponse.json({ error: "This post has no caption. Write one or press ✨ to generate it — only Stories go out without a caption. Nothing was sent." }, { status: 400 });
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
  // Anything carrying a RecurPost id is in their queue, whether we recorded it
  // as sent or failed. Keying the guard on our own status let a mis-read
  // failure through and the same creative went out twice.
  let alreadyQ = admin
    .from("social_posts")
    .select("platform, content_type, scheduled_for")
    .eq("client_id", clientId)
    .eq("media_url", publishUrl)
    .not("recurpost_post_id", "is", null)
    .gte("created_at", sinceIso);
  const scheduledIso = scheduledFor ? istWallClockToUtc(scheduledFor).toISOString() : null;
  // A time already gone gets refused HERE, in words, before RecurPost's
  // "Oops! You need to schedule your update for a time in the future!" burns
  // the whole send — it ate posts on 4, 6, 19 and 20 Oct. Two minutes of slack
  // so a send pressed right on the minute still goes.
  if (scheduledIso && new Date(scheduledIso).getTime() < Date.now() + 2 * 60_000) {
    const when = utcToIstWallClock(scheduledIso);
    return NextResponse.json(
      { error: `The scheduled time (${when} IST) has already passed — pick a time in the future, or clear it to post now. Nothing was sent.` },
      { status: 400 }
    );
  }
  alreadyQ = scheduledIso ? alreadyQ.eq("scheduled_for", scheduledIso) : alreadyQ.is("scheduled_for", null);
  const { data: alreadySent } = await alreadyQ;
  const alreadyKey = new Set((alreadySent || []).map((p) => `${p.platform}|${p.content_type}`));

  const results: Array<{ platform: string; contentType: string; ok: boolean; detail: string }> = [];

  // Whatever the team selected is what gets sent. YouTube rejecting an image
  // is warned about in the composer; if they choose it anyway that's their
  // call, and the failure shows in the Library with the reason.
  const skipped: string[] = [];
  // A send skipped because another copy is still on its way (sending, or
  // never answered clearly) has not put this creative out yet — so the hub
  // upload stays where it is. One skipped because the copy is already out
  // has, and does not hold it back.
  let heldBack = false;

  for (const platform of platforms) {
    // feed/story/reel only differ on FB & IG — other platforms get one post.
    const typesForPlatform = ["facebook", "instagram"].includes(platform) ? contentTypes : [contentTypes[0]];
    for (const contentType of typesForPlatform) {
      const accountId = Object.keys(rpMapping).find(
        (id) => rpMapping[id]?.client_id === clientId && rpMapping[id]?.platform === platform
      );
      let ok = false;
      let detail = "";
      // A fast pre-filter only — the reservation below is the authority.
      if (alreadyKey.has(`${platform}|${contentType}`)) {
        // Same client, same media, same slot, already away — don't post twice.
        skipped.push(`${platform} ${contentType} — already posted.`);
        continue;
      }
      // YouTube only accepts video. Platforms are auto-selected from the client
      // mapping, so an image post riding along isn't a conscious choice — skip
      // it cleanly rather than letting RecurPost reject it and log a failure.
      if (platform === "youtube" && !mediaIsVideo) {
        skipped.push("youtube — YouTube only accepts video. Upload a video to include YouTube.");
        continue;
      }
      const row = {
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
        scheduled_for: scheduledIso,
      };
      if (!accountId) {
        // Nothing goes to RecurPost, so there is no slot to claim — the
        // failure is simply recorded, as it always was.
        detail = `No RecurPost account mapped for ${client?.name || "this client"} on ${platform} — map it in Social Publisher → RecurPost Accounts.`;
        await admin.from("social_posts").insert({ ...row, status: "failed", recurpost_post_id: null, webhook_response: `[recurpost] ${detail}` });
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
        // Same reason as the retry path: cut the cover to the format's frame
        // ourselves rather than letting the platform re-encode a print file.
        let sendThumb = thumbnailUrl as string | null;
        if (mediaIsVideo && sendThumb) {
          const norm = await toPublishableThumbUrl(sendThumb);
          sendThumb = norm.url;
          if (norm.note) console.log(`🖼️ ${platform} ${contentType}: ${norm.note}`);
        }
        // fb_thumb / in_thumb / ln_thumb only apply to video posts — RecurPost
        // ignores them on an image post since there's nothing to override.
        if (platform === "facebook") {
          if (contentType !== "post") params.fb_post_type = contentType;
          if (mediaIsVideo && sendThumb) params.fb_thumb = sendThumb;
        }
        if (platform === "instagram") {
          if (contentType !== "post") params.in_post_type = contentType;
          if (contentType === "reel") params.in_reel_share_in_feed = "yes";
          if (mediaIsVideo && sendThumb) params.in_thumb = sendThumb;
        }
        if (platform === "linkedin" && mediaIsVideo && sendThumb) params.ln_thumb = sendThumb;
        if (platform === "youtube") {
          if (title) params.yt_title = title;
          // yt_thumb, not yt_thumbnail — the wrong name was accepted with a 200
          // and dropped, so thumbnails never reached YouTube.
          if (sendThumb) params.yt_thumb = sendThumb;
        }
        if (platform === "pinterest") params.pi_title = pinterestTitle(title, caption);

        // Claim the slot first. Only the request that wrote the row calls
        // RecurPost; a second click, a second person or a blind resend finds
        // the slot taken and is told so instead.
        const claim = await reserve(admin, row, {
          clientId, accountId, platform, contentType, mediaUrl: publishUrl, scheduledIso,
        });
        if (claim.kind === "duplicate") {
          skipped.push(`${platform} ${contentType} — ${claim.message}.`);
          if (!claim.alreadyOut) heldBack = true;
          continue;
        }
        if (claim.kind === "error") {
          detail = claim.message;
        } else {
          // A post id back means RecurPost queued it — that settles it. Only
          // when there is no id do we fall back to reading the body for errors.
          const outcome = await sendToRecurPost(params);
          detail = explainFailure(platform, outcome.detail);
          ok = outcome.status === "sent";
          await settle(admin, claim.id, outcome, `[recurpost] ${detail}`);
        }
      }
      results.push({ platform, contentType, ok, detail });
    }
  }

  const failed = results.filter((r) => !r.ok);

  // If this came from a Content Hub upload and everything sent, mark it handled
  // so it leaves the "received" tray.
  // The thumbnail comes from its own Content Hub section (designers upload covers
  // separately from the editors' reels) — retire it with the reel it was used on.
  if (failed.length === 0 && !heldBack) {
    const usedIds = [uploadId, thumbUploadId].filter(Boolean) as string[];
    if (usedIds.length > 0) {
      await admin.from("creative_uploads").update({ status: "scheduled" }).in("id", usedIds);
    }
  }

  // A deliberate skip is not a failure — don't report the whole send as failed.
  return NextResponse.json({ success: failed.length === 0, results, skipped });
}

/**
 * PATCH — edit a post in the Library.
 *
 * What editing can actually achieve depends entirely on where the post is:
 *
 *  - Failed, or never scheduled: nothing is queued anywhere, so the edit is the
 *    whole fix. Correct it and send.
 *  - Accepted by RecurPost for a future time: RecurPost's API can create a post
 *    but cannot change or cancel one. Editing here does NOT change what they
 *    will publish. The row is flagged so the Library keeps saying so, and the
 *    team is told to delete that post id in RecurPost's Queue and re-send.
 *  - Already published: the platform has it. Nothing here can alter that.
 *
 * Body: { id, title?, caption?, mediaUrl?, mediaIsVideo?, thumbnailUrl?, scheduledFor? }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  if (!["founder", "employee"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();

  // A flagged duplicate, closed out by a person: "Mark removed" once the copy
  // is deleted in RecurPost's Queue, "Not a duplicate" when the flag was
  // wrong. Only the flag changes — the row, and the original it pointed at,
  // stay exactly as they are. Nothing is deleted here or anywhere.
  if (body.action === "duplicate_resolution") {
    const resolution = body.resolution === "resolved" || body.resolution === "ignored" ? body.resolution : null;
    if (!resolution) return NextResponse.json({ error: "resolution must be resolved or ignored" }, { status: 400 });
    const { data: upd, error } = await admin
      .from("social_posts")
      .update({ duplicate_resolution_status: resolution })
      .eq("id", body.id)
      .eq("duplicate_resolution_status", "manual_removal_required")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!upd || upd.length === 0) return NextResponse.json({ error: "This post is not flagged as a duplicate any more." }, { status: 409 });
    return NextResponse.json({
      success: true,
      message: resolution === "resolved" ? "Marked removed — the duplicate is closed." : "Marked as not a duplicate.",
    });
  }

  const { data: post } = await admin.from("social_posts").select("*").eq("id", body.id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const scheduledMs = post.scheduled_for ? new Date(post.scheduled_for as string).getTime() : 0;
  const alreadyPublished = post.status === "sent" && (!post.scheduled_for || scheduledMs <= Date.now());
  if (alreadyPublished) {
    return NextResponse.json(
      { error: "This one has already gone out — editing here would change our record but not the live post. Edit or remove it on the platform itself." },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title || null;
  if (body.caption !== undefined) patch.caption = body.caption || null;
  if (body.thumbnailUrl !== undefined) patch.thumbnail_url = body.thumbnailUrl || null;
  if (body.mediaUrl !== undefined && body.mediaUrl) {
    patch.media_url = body.mediaUrl;
    patch.media_is_video = !!body.mediaIsVideo;
  }
  if (body.scheduledFor !== undefined) {
    patch.scheduled_for = body.scheduledFor ? istWallClockToUtc(body.scheduledFor).toISOString() : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // Queued at RecurPost — our copy and theirs are now deliberately out of step.
  const stillQueuedThere = post.status === "sent" && scheduledMs > Date.now();
  if (stillQueuedThere) patch.needs_recurpost_cleanup = true;

  const { error } = await admin.from("social_posts").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    stillQueuedThere,
    recurpostPostId: post.recurpost_post_id ?? null,
    message: stillQueuedThere
      ? `Saved here — but RecurPost still holds the original and their API gives us no way to change or cancel it. Open RecurPost → Queue, delete post ${post.recurpost_post_id ?? "(id not recorded)"}, then press Re-send.`
      : "Saved. Nothing is queued anywhere yet, so press Send when you're ready.",
  });
}

/**
 * DELETE — remove a post from the Library.
 *
 * RecurPost's API can create a post but not cancel one (verified against their
 * published API, which documents login, posting, libraries and history only).
 * So deleting a future-scheduled row here does NOT stop it publishing — and
 * removing the row is worse than keeping it, because it also removes the post
 * id, which is the only handle for deleting it inside RecurPost's Queue.
 *
 * A row still queued there is therefore refused until the caller confirms the
 * RecurPost side is done, and the refusal carries the ids to type in. That is
 * what turned "deleted from the library but it posted anyway" from a surprise
 * into a step.
 */
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

  if (!body.confirmedRemoved) {
    const { data: rows } = await admin
      .from("social_posts")
      .select("id, platform, content_type, scheduled_for, recurpost_post_id, status")
      .in("id", ids);
    const stillQueued = (rows || []).filter(
      (p) =>
        p.recurpost_post_id &&
        p.scheduled_for &&
        new Date(p.scheduled_for as string).getTime() > Date.now()
    );
    if (stillQueued.length > 0) {
      return NextResponse.json(
        {
          error: "RecurPost is still going to publish these — deleting the library row does not cancel them, and their API has no way to.",
          needsConfirmation: true,
          stillQueued: stillQueued.map((p) => ({
            id: p.id,
            platform: p.platform,
            contentType: p.content_type,
            scheduledFor: p.scheduled_for,
            recurpostPostId: p.recurpost_post_id,
          })),
        },
        { status: 409 }
      );
    }
  }

  const { error } = await admin.from("social_posts").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deleted: ids.length });
}
