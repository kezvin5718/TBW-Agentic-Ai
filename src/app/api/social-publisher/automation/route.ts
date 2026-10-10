import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, postContent } from "@/lib/recurpost";
import { istWallClockToUtc, utcToIstWallClock } from "@/lib/time";
import { toPublishableVideoUrl, toPublishableThumbUrl, isDriveUrl } from "@/lib/publishable-media";
import { isDriveConnected } from "@/lib/google-drive";

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
 * A story repeat, as the screen asked for it — or null for "just the once".
 *
 * Anything that is not exactly one of the two modes is read as no repeat at
 * all, rather than guessed at: a wrong guess here is a week of stories nobody
 * meant to post. The count is held to 2–30 whatever arrives.
 */
function repeatPlanOf(raw: unknown): { step: number; times: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode, times } = raw as { mode?: unknown; times?: unknown };
  if (mode !== "everyday" && mode !== "alternate") return null;
  const n = Math.round(Number(times));
  if (!Number.isFinite(n)) return null;
  return { step: mode === "everyday" ? 1 : 2, times: Math.min(30, Math.max(2, n)) };
}

/**
 * Where a feed creative is to go: the feed, the Story, or both.
 *
 * Anything other than exactly "story" or "both" is the feed — today's
 * behaviour — rather than a guess: a wrong guess here is a caption-less Story
 * nobody asked for.
 */
function sendAsOf(raw: unknown): "feed" | "story" | "both" {
  return raw === "story" || raw === "both" ? raw : "feed";
}

/**
 * "2026-10-01T19:00" moved on by whole calendar days, same wall-clock time.
 *
 * Done on the date itself, not on the instant: adding 24 hours to a converted
 * UTC time is the kind of arithmetic that lands a 23:30 story on the wrong day
 * the moment anything about the conversion shifts. The time part is carried
 * across untouched. Null when the slot is not in the shape the screen sends.
 */
function shiftWallClockDays(wallClock: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T.*)$/.exec(String(wallClock).trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
  return `${date}${m[4]}`;
}

/**
 * GET /api/social-publisher/automation?clientId=…
 *
 * Everything approved and waiting for this client, captions already written.
 *
 * Only clean work appears: a creative whose batch failed QC, or that QC could
 * not vouch for, is excluded, because the whole point is that the team opens
 * this screen and finds nothing left to check. With ?risk=1 those same
 * creatives are listed instead, each carrying the reason it was held back.
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
  // Risk mode: the founder wants to see what QC refused, and decide for himself.
  const risk = request.nextUrl.searchParams.get("risk") === "1";

  const admin = createServiceRoleClient();
  const COLUMNS = "id, file_url, file_name, media_type, content_type, caption, caption_status, qc_status, qc_note, rejected_reason, risk_accepted_at, thumbnail_url, created_at";
  const { data, error } = await admin
    .from("creative_uploads")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .eq("status", "uploaded")
    .eq("qc_status", "match")
    .is("festival_id", null)
    .neq("content_type", "thumbnail")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The unblessed ones, carrying the reason they were held back. They arrive in
  // the same shape as everything else and flagged, so the screen can mix them
  // into one list rather than keeping a second one.
  //
  // Two kinds of unblessed, not one. The obvious kind is a batch QC rejected
  // outright (status 'rejected'). The kind that went missing entirely is a
  // creative QC could not make up its mind about — status still 'uploaded',
  // qc_status 'unsure' (or 'mismatch' on a row with no batch to reject, or
  // 'skipped') — which passes neither the Clear list's qc_status='match' test
  // nor the old risk list's status='rejected' test, so it appeared in no mode at
  // all. QC returns "unsure" on perfectly good work often enough that this hole
  // swallowed whole deliveries.
  //
  // 'pending' and null are deliberately NOT here: QC has not run on those yet,
  // and "not yet judged" is a different thing from "judged and unconvinced".
  // They belong in the Clear list once QC gets to them, not in Risk now.
  let refused: Record<string, unknown>[] = [];
  if (risk) {
    const risky = () => admin
      .from("creative_uploads")
      .select(COLUMNS)
      .eq("client_id", clientId)
      .is("festival_id", null)
      .neq("content_type", "thumbnail")
      .order("created_at", { ascending: true });
    const [{ data: rejectedRows }, { data: unblessedRows }] = await Promise.all([
      risky().eq("status", "rejected"),
      risky().eq("status", "uploaded").not("qc_status", "is", null).not("qc_status", "in", "(match,pending)"),
    ]);
    refused = [
      ...(rejectedRows || []).map((r) => ({ ...r, rejected: true })),
      // No rejected_reason on these — nothing rejected them. The reason is the
      // QC verdict itself, written into the same field the screen already reads,
      // so the row explains itself without the page learning a second shape.
      ...(unblessedRows || []).map((r) => ({
        ...r,
        rejected: true,
        rejected_reason: `QC ${r.qc_status}: ${r.qc_note || "could not verify the brand"}`,
      })),
    ].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  }

  // Which platforms this client can actually receive a post on.
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const rpMapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};
  const platforms = Array.from(
    new Set(Object.values(rpMapping).filter((m) => m?.client_id === clientId).map((m) => m.platform).filter(Boolean))
  );

  // Held back for a fix rather than silently missing from the list. Only the
  // last week counts: a banner that adds up every creative ever rejected keeps
  // reporting the same seven long after they were dealt with, and a number that
  // never moves is one nobody reads.
  //
  // Nothing stamps a rejection time on these rows, so recency is read from when
  // the creative was uploaded — close enough, since a batch is judged within
  // minutes of arriving.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rejectedQuery = () => admin
    .from("creative_uploads")
    .select("file_name", { count: "exact" })
    .eq("client_id", clientId)
    .eq("status", "rejected")
    .gte("created_at", weekAgo);
  const [{ count: rejectedCount }, { data: rejectedRows }] = await Promise.all([
    rejectedQuery().limit(1),
    rejectedQuery().order("created_at", { ascending: false }).limit(10),
  ]);

  const rows = [...(data || []).map((r) => ({ ...r, rejected: false })), ...refused];
  return NextResponse.json({
    success: true,
    uploads: rows,
    riskMode: risk,
    platforms,
    rejected: rejectedCount || 0,
    rejectedNames: (rejectedRows || []).map((r) => r.file_name).filter(Boolean),
    awaitingCaption: rows.filter((r) => r.caption_status !== "done" && !String(r.caption || "").trim()).length,
  });
}

/**
 * POST /api/social-publisher/automation
 * Body: { clientId, platforms[], items: [{ uploadId, caption, scheduledFor, repeat?, sendAs? }] }
 *
 * Schedules the whole list in one go and retires each creative from the hub.
 *
 * A story row may carry repeat: { mode: "everyday" | "alternate", times } —
 * one upload, many days. It is unrolled into one occurrence per day before
 * anything is sent, so every day goes out exactly as a row of its own would.
 *
 * A post or reel row may carry sendAs: "feed" | "story" | "both" — the same
 * creative sent as a Story instead of, or as well as, the feed post. Unrolled
 * the same way, before the loop: "both" is two occurrences at one slot. A
 * Story occurrence never carries a caption, and goes to Instagram and
 * Facebook only.
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
    let written = 0;
    const problems: string[] = [];
    for (const r of todo) {
      // A failed attempt has to be allowed another go, or the row stays empty
      // for good.
      if (r.caption_status === "failed" || r.caption_status === "no_contact") {
        await admin2.from("creative_uploads").update({ caption_status: "none" }).eq("id", r.id);
      }
      if (await writeCaptionFor(r.id)) written++;
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
  const items: Array<{ uploadId: string; caption?: string; scheduledFor: string; repeat?: unknown; sendAs?: unknown }> = Array.isArray(body.items) ? body.items : [];

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

  // A Drive-hosted video cannot be published as-is — it has to be copied out of
  // Drive first (see publishable-media), and a rejected Drive token makes that
  // impossible. Saturday's Risk-mode run learned that one row at a time: a wall
  // of "could not prepare the video" lines that named the symptom and never the
  // cause. Ask Drive once, before anything is sent, and say the single true
  // thing instead. Images are untouched by this — Drive serves those directly,
  // so an image-only batch goes out exactly as it does today.
  const needsDrive = (uploads || []).some(
    (u) => u.media_type === "video" && typeof u.file_url === "string" && isDriveUrl(u.file_url)
  );
  if (needsDrive && !(await isDriveConnected())) {
    return NextResponse.json(
      { error: "Google Drive is disconnected, so videos cannot be prepared for publishing. Reconnect it in Integrations → Google Drive, then send again — nothing was posted, so this cost nothing." },
      { status: 400 }
    );
  }

  const results: Array<{ uploadId: string; platform: string; ok: boolean; detail: string; skipped?: boolean }> = [];
  const skipped: string[] = [];
  const doneUploads = new Set<string>();
  const stagedCache = new Map<string, string>();
  // One creative fans out across platforms and content types — normalise its
  // cover once per run rather than re-fetching it for every send.
  const thumbCache = new Map<string, string>();

  // Sending from Risk mode is the founder saying, deliberately, that he has
  // looked at what QC refused and is publishing it anyway.
  const riskRun = body.risk === true;
  const overridden: string[] = [];

  // Story repeats, unrolled. Each day becomes an item of its own — same upload,
  // same caption, the slot moved on by whole days — so the send loop below
  // never has to know a repeat exists. Only a story is ever repeated: the
  // screen never offers it on anything else, and anything that claims
  // otherwise goes out once, exactly as it always did.
  //
  // Send-as, unrolled in the same pass. A post or reel sent as a Story becomes
  // one occurrence flagged asStory; sent as both, two at the same slot — the
  // feed one exactly as today, then the Story. Only a post or a reel is ever
  // re-routed: a story upload already is one and ignores the flag. The two
  // never combine — repeats are offered on story rows, send-as on feed rows —
  // so a row that somehow carries both has its repeat dropped rather than
  // multiplied into a week of Stories nobody saw on screen.
  type Occurrence = { uploadId: string; caption?: string; scheduledFor: string; asStory?: boolean };
  const occurrences = items.flatMap((item): Occurrence[] => {
    const { repeat, sendAs, ...plain } = item;
    const kind = byId.get(item.uploadId)?.content_type;
    const route = sendAsOf(sendAs);
    if (route !== "feed" && (kind === "post" || kind === "reel")) {
      return route === "story" ? [{ ...plain, asStory: true }] : [plain, { ...plain, asStory: true }];
    }
    const plan = repeatPlanOf(repeat);
    if (!plan || kind !== "story") return [plain];
    const days: Occurrence[] = [];
    for (let k = 0; k < plan.times; k++) {
      const scheduledFor = shiftWallClockDays(item.scheduledFor, k * plan.step);
      // A slot in a shape we cannot move is sent once rather than not at all.
      if (!scheduledFor) return [plain];
      days.push({ ...plain, scheduledFor });
    }
    return days;
  });

  // RecurPost refuses a caption-less post or reel with an opaque 400, so the
  // refusal happens here instead, naming the files, before anything is sent.
  // Stories — born or converted — are the only captionless sends.
  const missingCaption = occurrences.filter((o) => {
    const u = byId.get(o.uploadId);
    if (!u) return false;
    const ct = o.asStory ? "story" : (u.content_type || "post");
    return ct !== "story" && !String(o.caption || "").trim();
  });
  if (missingCaption.length > 0) {
    const names = [...new Set(missingCaption.map((o) => byId.get(o.uploadId)?.file_name || "a creative"))];
    return NextResponse.json({
      error: `${names.length} creative(s) have no caption: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}. Write or generate captions first — only Stories go out without one. Nothing was sent.`,
    }, { status: 400 });
  }

  // A video that could not be prepared once will not be prepared on its second
  // day either. Remembered so a repeated story is tried — and reported — once,
  // not once per day.
  const stageFailed = new Map<string, string>();

  for (const item of occurrences) {
    const upload = byId.get(item.uploadId);
    if (!upload) { skipped.push(`${item.uploadId} — no longer in the hub.`); continue; }
    // Re-checked at send time: a batch can be rejected between loading the
    // screen and pressing the button, and rejected work must never go out —
    // unless this run is an explicit override of exactly that.
    //
    // The override has to cover everything Risk mode shows, not just the rows
    // marked 'rejected'. A creative QC was unsure about is still sitting at
    // status 'uploaded' with a qc_status that is not 'match', and the guard
    // below used to bounce it as "no longer approved" even though the founder
    // had just looked at it in Risk mode and pressed send.
    const isOverride = riskRun && (
      upload.status === "rejected" ||
      (upload.status === "uploaded" && upload.qc_status !== "match")
    );
    if (!isOverride && (upload.status !== "uploaded" || upload.qc_status !== "match")) {
      skipped.push(`${upload.id} — no longer approved (${upload.status}/${upload.qc_status}).`);
      continue;
    }
    if (isOverride) overridden.push(upload.id as string);

    const isVideo = upload.media_type === "video";
    let publishUrl = upload.file_url as string;
    if (isVideo) {
      if (stagedCache.has(publishUrl)) publishUrl = stagedCache.get(publishUrl)!;
      else if (stageFailed.has(publishUrl)) continue;
      else {
        const staged = await toPublishableVideoUrl(publishUrl);
        if (!staged.url) {
          const detail = staged.error || "Could not prepare the video.";
          stageFailed.set(publishUrl, detail);
          results.push({ uploadId: upload.id, platform: "-", ok: false, detail });
          continue;
        }
        stagedCache.set(upload.file_url as string, staged.url);
        publishUrl = staged.url;
      }
    }

    const scheduledUtc = istWallClockToUtc(item.scheduledFor);
    const scheduledIso = scheduledUtc.toISOString();
    // A feed creative sent as a Story is a Story from here on, in every respect:
    // the RecurPost story params, the null caption, the social_posts record all
    // read this one value, so there is no second place to forget.
    const contentType = item.asStory ? "story" : (upload.content_type || "post");
    let anyOk = false;

    for (const platform of platforms) {
      // Only Instagram and Facebook have Stories. Anything else selected for
      // the run still takes the feed post; the Story pass is simply not theirs,
      // and asking would be a certain refusal recorded as a failure.
      if (item.asStory && platform !== "instagram" && platform !== "facebook") {
        results.push({ uploadId: upload.id, platform, ok: false, skipped: true, detail: "Stories are Instagram/Facebook only — skipped" });
        continue;
      }

      // YouTube takes video and nothing else. Sending it an image is a
      // guaranteed RecurPost 3003 ("You Must upload Video"), and that one
      // certain failure is what used to hold the whole creative back — so the
      // call is never made rather than made and mourned.
      if (platform === "youtube" && !isVideo) {
        results.push({ uploadId: upload.id, platform, ok: false, skipped: true, detail: "YouTube takes videos only — skipped" });
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
          // The manual publisher checks a cover against the platform's upload
          // ceiling before sending it; this path did not, so a designer's
          // 20MB print-resolution cover went out raw and came back
          // re-compressed. Same guard, same rule: full resolution kept, only
          // an over-ceiling file is made lighter.
          const cover = thumbCache.get(upload.thumbnail_url as string)
            ?? (await toPublishableThumbUrl(upload.thumbnail_url as string)).url;
          thumbCache.set(upload.thumbnail_url as string, cover);
          if (platform === "facebook") params.fb_thumb = cover;
          if (platform === "instagram") params.in_thumb = cover;
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
        webhook_response: `${isOverride ? "[risk-override] " : ""}[automation] ${detail}`,
      });

      results.push({ uploadId: upload.id, platform, ok, detail });
      if (ok) anyOk = true;
    }

    if (anyOk) doneUploads.add(upload.id);
  }

  // Posted anywhere means posted. Requiring every platform to succeed meant one
  // refusal held the creative in the list, and the next run sent it again — the
  // reason yesterday's posts kept coming back.
  if (doneUploads.size > 0) {
    await admin.from("creative_uploads").update({ status: "scheduled" }).in("id", Array.from(doneUploads));
  }

  // Who overruled QC, and when. Written on the upload itself so the record
  // outlives this request and travels with the creative.
  const stampable = overridden.filter((id) => doneUploads.has(id));
  if (stampable.length > 0) {
    await admin
      .from("creative_uploads")
      .update({ risk_accepted_at: new Date().toISOString(), risk_accepted_by: user.id })
      .in("id", stampable);
  }

  // A platform that was never going to take this creative is not a failure.
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const namesOf = (rows: typeof results) => [...new Set(rows.map((r) => r.platform))].join(", ");
  const posted = results.filter((r) => r.ok);
  // Two reasons a platform sits one out, and each says its own.
  const storySkips = results.filter((r) => r.skipped && r.detail.startsWith("Stories"));
  const videoSkips = results.filter((r) => r.skipped && !r.detail.startsWith("Stories"));
  const message = [
    posted.length ? `posted to ${namesOf(posted)}` : "nothing posted",
    failed.length ? `failed on ${namesOf(failed)}` : "",
    videoSkips.length ? `${namesOf(videoSkips)} skipped (video only)` : "",
    storySkips.length ? `${namesOf(storySkips)} skipped for Stories (Instagram/Facebook only)` : "",
  ].filter(Boolean).join(" · ");

  return NextResponse.json({
    success: failed.length === 0,
    scheduled: doneUploads.size,
    posts: posted.length,
    // Days sent in all, repeats unrolled — what lets the screen say "story
    // scheduled 7 times" rather than leave the team to divide.
    occurrences: occurrences.length,
    failed: failed.length,
    message,
    results,
    // A repeated story that is no longer approved is refused on every one of
    // its days; the reason only needs saying once.
    skipped: [...new Set(skipped)],
  });
}
