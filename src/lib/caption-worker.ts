import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Captions write themselves.
 *
 * The founder's rule (24 Nov 2026): the team uploads and publishes, and nothing
 * in between should need a click. Every creative that can carry a caption —
 * post, reel, carousel; never a Story, a thumbnail or a festival creative — is
 * queued the moment it lands (a database trigger sets caption_status
 * 'pending' on insert, and again when its media is replaced), read properly
 * (frames, on-screen text, the spoken soundtrack, every carousel slide), and
 * captioned in the brand's own format.
 *
 * It is deliberately independent of QC: a creative QC rejected still gets its
 * caption, and QC passing never asks for a second one.
 *
 * Statuses on creative_uploads.caption_status:
 *   pending    — queued, nobody has started it
 *   analysing  — reading the creative (frames, text, audio)
 *   writing    — the reading is done, the caption is being written
 *   done       — a caption is in place (caption_source says whose)
 *   failed     — the last attempt failed; retried until MAX_ATTEMPTS
 *   no_contact — the brand has no address/phone on file; retried when it does
 *   skipped    — a Story, thumbnail or festival creative: no caption, ever
 *   none       — legacy rows from before this existed; never picked up
 *
 * A caption a person typed or edited is caption_source 'manual' and is never
 * overwritten by this job. Only a person pressing Rewrite replaces it.
 */

type Admin = ReturnType<typeof createServiceRoleClient>;

export const MAX_CAPTION_ATTEMPTS = 3;
/** A job still "analysing" after this long was cut off — a restart or a deploy. */
const STALE_MS = 15 * 60_000;
/** Wait before trying a failed one again: 2 minutes after the first, 10 after the second. */
const BACKOFF_MS = [0, 2 * 60_000, 10 * 60_000];
/** A carousel row lands a moment before its slides; give them this long to arrive. */
const SLIDE_GRACE_MS = 10 * 60_000;
/** How often brands with no contact details are re-checked. */
const CONTACT_RECHECK_MS = 10 * 60_000;

const ROW_COLS =
  "id, client_id, file_url, thumbnail_url, media_type, content_type, caption, caption_status, caption_source, caption_attempts, caption_media_key, caption_started_at, reading_key, vision_description, on_creative_text, audio_transcript, festival_id, created_at";

interface Row {
  id: string;
  client_id: string | null;
  file_url: string;
  thumbnail_url: string | null;
  media_type: string;
  content_type: string | null;
  caption: string | null;
  caption_status: string | null;
  caption_source: string | null;
  caption_attempts: number | null;
  caption_media_key: string | null;
  caption_started_at: string | null;
  reading_key: string | null;
  vision_description: string | null;
  on_creative_text: string | null;
  audio_transcript: string | null;
  festival_id: string | null;
  created_at: string;
}

export interface CaptionOutcome {
  ok: boolean;
  caption?: string;
  error?: string;
  /** Another run is writing this one right now. */
  busy?: boolean;
}

/** Survives Next's dev reloads and keeps one sweep at a time per server. */
const store = globalThis as unknown as {
  __captionWorker?: { busy: boolean; again: boolean; active: Set<string>; lastContactCheck: number; timer: ReturnType<typeof setTimeout> | null };
};
function state() {
  if (!store.__captionWorker) store.__captionWorker = { busy: false, again: false, active: new Set(), lastContactCheck: 0, timer: null };
  return store.__captionWorker;
}

const isEligible = (r: Pick<Row, "festival_id" | "content_type">) =>
  !r.festival_id && !["story", "thumbnail"].includes(String(r.content_type || "post"));

/** One line in the job log. Never throws — the log must not be the thing that fails a caption. */
async function log(admin: Admin, uploadId: string, attempt: number | null, stage: string, message?: string) {
  try {
    await admin.from("caption_job_log").insert({ upload_id: uploadId, attempt, stage, message: message ? message.slice(0, 1000) : null });
  } catch { /* the log is best-effort */ }
}

/** The version of the media a caption belongs to: the file, and for a carousel every slide in order. */
async function mediaOf(admin: Admin, row: Row): Promise<{ key: string; slides: string[] }> {
  if (row.content_type !== "carousel") return { key: row.file_url, slides: [] };
  const { data } = await admin.from("carousel_slides").select("file_url").eq("upload_id", row.id).order("slide_no", { ascending: true });
  const slides = (data || []).map((s) => String(s.file_url || "")).filter(Boolean);
  return { key: [row.file_url, ...slides].join("|"), slides };
}

/**
 * Write (or rewrite) one creative's caption.
 *
 * `by: "auto"` is the background job: it never touches a hand-written caption,
 * never repeats a caption already written for this same media, and gives up
 * after three failed attempts. `by: "person"` is somebody pressing a button:
 * attempts start again from nothing, and with `force` even a written or
 * hand-edited caption is replaced — they asked for exactly that.
 */
export async function generateCaption(
  uploadId: string,
  opts: { force?: boolean; brief?: string; by?: "auto" | "person" } = {}
): Promise<CaptionOutcome> {
  const by = opts.by || "auto";
  const admin = createServiceRoleClient();
  const { data } = await admin.from("creative_uploads").select(ROW_COLS).eq("id", uploadId).maybeSingle();
  const row = data as Row | null;
  if (!row) return { ok: false, error: "That creative no longer exists." };

  if (!isEligible(row)) {
    if (row.caption_status !== "skipped") await admin.from("creative_uploads").update({ caption_status: "skipped" }).eq("id", uploadId);
    return { ok: false, error: row.festival_id ? "Festival creatives carry their own line." : "A Story carries no caption." };
  }

  const w = state();
  const inFlight = row.caption_status === "analysing" || row.caption_status === "writing";
  const startedMs = row.caption_started_at ? new Date(row.caption_started_at).getTime() : 0;
  if (inFlight && (w.active.has(uploadId) || Date.now() - startedMs < STALE_MS)) {
    return { ok: false, busy: true, error: "Being written right now — it will appear here in a moment." };
  }

  const { key, slides } = await mediaOf(admin, row);

  if (!opts.force) {
    if (row.caption_source === "manual") {
      if (row.caption_status !== "done") await admin.from("creative_uploads").update({ caption_status: "done" }).eq("id", uploadId);
      return { ok: false, error: "This caption was written by hand — it is kept as it is. Press Rewrite to replace it." };
    }
    if (row.caption_status === "done" && String(row.caption || "").trim() && (row.caption_media_key === key || !row.caption_media_key)) {
      return { ok: false, error: "This one already has a caption." };
    }
    if (by === "auto" && row.caption_status === "failed" && Number(row.caption_attempts || 0) >= MAX_CAPTION_ATTEMPTS) {
      return { ok: false, error: "Gave up after three attempts — press Retry." };
    }
  }

  // A carousel recorded a moment ago may not have its slides saved yet.
  if (row.content_type === "carousel" && slides.length === 0 && Date.now() - new Date(row.created_at).getTime() < SLIDE_GRACE_MS) {
    return { ok: false, error: "Waiting for the carousel's slides to finish saving." };
  }

  // A brand with no address on file cannot have a caption at all, and finding
  // that out costs nothing — check before paying for a read.
  const { contactGap } = await import("@/lib/caption-engine");
  const gap = await contactGap(row.client_id);
  if (gap) {
    await admin.from("creative_uploads")
      .update({ caption_status: "no_contact", caption_error: gap, caption_updated_at: new Date().toISOString() })
      .eq("id", uploadId);
    if (row.caption_status !== "no_contact") await log(admin, uploadId, null, "no_contact", gap);
    return { ok: false, error: gap };
  }

  // Claim it. Only the run whose update lands does the work — two sweeps, a
  // sweep and a button, or two buttons can never write the same caption twice.
  const attempt = (by === "person" ? 0 : Number(row.caption_attempts || 0)) + 1;
  let claim = admin
    .from("creative_uploads")
    .update({ caption_status: "analysing", caption_attempts: attempt, caption_started_at: new Date().toISOString(), caption_error: null })
    .eq("id", uploadId)
    .eq("caption_attempts", Number(row.caption_attempts || 0));
  claim = row.caption_status ? claim.eq("caption_status", row.caption_status) : claim.is("caption_status", null);
  const { data: claimed } = await claim.select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, busy: true, error: "Being written right now — it will appear here in a moment." };
  }
  w.active.add(uploadId);
  await log(admin, uploadId, attempt, "started", `${by}${opts.force ? " · rewrite" : ""}${row.caption_status === "analysing" || row.caption_status === "writing" ? " · resuming an interrupted job" : ""}`);

  try {
    // The reading is kept with the media it came from, so an interrupted job,
    // a retry or a rewrite of the same creative reuses it instead of paying for
    // ten frames and a transcription again.
    let reading = {
      description: row.vision_description || "",
      onCreativeText: row.on_creative_text || "",
      audioTranscript: row.audio_transcript || "",
    };
    const haveReading = row.reading_key === key && !!(reading.description || reading.onCreativeText || reading.audioTranscript);
    if (!haveReading) {
      const { readCreative, readCarousel } = await import("@/lib/creative-reader");
      const r = row.content_type === "carousel"
        ? await readCarousel(slides.length ? slides : [row.file_url])
        : await readCreative(row.file_url, row.media_type, { audio: row.media_type === "video" });
      let description = r.description;
      let onCreativeText = r.onCreativeText;
      let framesRead = r.framesRead;
      // A video too large or too broken to sample still has its cover.
      if (!description && !onCreativeText && row.media_type === "video" && row.thumbnail_url) {
        const cover = await readCreative(row.thumbnail_url, "image");
        description = cover.description;
        onCreativeText = cover.onCreativeText;
        framesRead = cover.framesRead;
      }
      if (!description && !onCreativeText && !r.audioTranscript) {
        throw new Error("Could not read the creative — the file would not download or decode.");
      }
      reading = { description, onCreativeText, audioTranscript: r.audioTranscript };
      await admin.from("creative_uploads").update({
        vision_description: description || null,
        on_creative_text: onCreativeText || null,
        audio_transcript: r.audioTranscript || null,
        frames_read: framesRead || null,
        reading_key: key,
      }).eq("id", uploadId);
      await log(admin, uploadId, attempt, "read", `${framesRead} frame(s)/slide(s)${r.audioTranscript ? ", speech transcribed" : ""}${onCreativeText ? ", text found" : ""}`);
    }

    await admin.from("creative_uploads").update({ caption_status: "writing" }).eq("id", uploadId);

    const { writeCaptionForClient } = await import("@/lib/caption-engine");
    const written = await writeCaptionForClient({
      clientId: row.client_id as string,
      platform: "instagram",
      contentType: row.content_type || "post",
      brief: opts.brief,
      mediaUrl: row.file_url,
      mediaIsVideo: row.media_type === "video",
      thumbnailUrl: row.thumbnail_url || undefined,
      visionDescription: reading.description,
      onCreativeText: reading.onCreativeText,
      audioTranscript: reading.audioTranscript,
    });
    if (!written.ok) {
      if (written.code === "missing_contact") {
        await admin.from("creative_uploads")
          .update({ caption_status: "no_contact", caption_error: written.error, caption_updated_at: new Date().toISOString() })
          .eq("id", uploadId);
        await log(admin, uploadId, attempt, "no_contact", written.error);
        return { ok: false, error: written.error };
      }
      throw new Error(written.error || "no caption came back");
    }

    // Saved only if the media is still the one that was read, and — for the
    // background job — only if nobody typed their own caption meanwhile.
    let save = admin
      .from("creative_uploads")
      .update({
        caption: written.caption,
        caption_status: "done",
        caption_source: "ai",
        caption_media_key: key,
        caption_error: null,
        caption_updated_at: new Date().toISOString(),
      })
      .eq("id", uploadId)
      .eq("file_url", row.file_url);
    if (by === "auto") save = save.or("caption_source.is.null,caption_source.eq.ai");
    const { data: saved } = await save.select("id");
    if (!saved || saved.length === 0) {
      // Someone wrote their own caption, or replaced the file, while this was
      // being written. Theirs stands; a replaced file is already queued again.
      const { data: now } = await admin.from("creative_uploads").select("caption_source, file_url").eq("id", uploadId).maybeSingle();
      if (now?.caption_source === "manual") {
        await admin.from("creative_uploads").update({ caption_status: "done", caption_updated_at: new Date().toISOString() }).eq("id", uploadId);
        await log(admin, uploadId, attempt, "kept_manual", "a hand-written caption arrived first and was kept");
        return { ok: false, error: "A hand-written caption arrived first and was kept." };
      }
      await log(admin, uploadId, attempt, "superseded", "the media was replaced while this was written — queued again");
      return { ok: false, error: "The file was replaced while this was written — a new caption is on its way." };
    }
    await log(admin, uploadId, attempt, "written", `${written.bodyWords} body words · ${written.model}`);
    return { ok: true, caption: written.caption };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const final = attempt >= MAX_CAPTION_ATTEMPTS;
    await admin.from("creative_uploads")
      .update({ caption_status: "failed", caption_error: message.slice(0, 500), caption_updated_at: new Date().toISOString() })
      .eq("id", uploadId)
      .in("caption_status", ["analysing", "writing"]);
    await log(admin, uploadId, attempt, final ? "gave_up" : "failed", message);
    console.error(`caption ${uploadId}: attempt ${attempt} of ${MAX_CAPTION_ATTEMPTS} failed — ${message}`);
    return { ok: false, error: message };
  } finally {
    w.active.delete(uploadId);
  }
}

export interface CaptionSweep { busy: boolean; picked: number; written: number; failed: number; recovered: number; requeued: number }

/**
 * One pass over the queue: recover what a restart cut off, re-check brands that
 * were missing contact details, then write up to `limit` captions, oldest
 * first, one at a time — each one is a video download, ten vision reads and a
 * transcription, and the portal must not feel it.
 */
export async function processPendingCaptions(limit = 4): Promise<CaptionSweep> {
  const w = state();
  const out: CaptionSweep = { busy: false, picked: 0, written: 0, failed: 0, recovered: 0, requeued: 0 };
  if (w.busy) { w.again = true; return { ...out, busy: true }; }
  w.busy = true;
  const admin = createServiceRoleClient();
  try {
    // 1. Interrupted jobs. A row still "analysing" long after it started, and
    //    not being worked on by this server, was cut off by a restart. It goes
    //    back to failed with its attempt counted, and is picked up below.
    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    const { data: stale } = await admin
      .from("creative_uploads")
      .select("id, caption_attempts")
      .in("caption_status", ["analysing", "writing"])
      .or(`caption_started_at.is.null,caption_started_at.lt.${staleBefore}`)
      .limit(50);
    for (const s of stale || []) {
      if (w.active.has(s.id as string)) continue;
      const { data: moved } = await admin.from("creative_uploads")
        .update({ caption_status: "failed", caption_error: "Interrupted before it finished (a restart) — trying again.", caption_updated_at: new Date().toISOString() })
        .eq("id", s.id)
        .in("caption_status", ["analysing", "writing"])
        .select("id");
      if (moved?.length) {
        out.recovered++;
        await log(admin, s.id as string, Number(s.caption_attempts || 0), "interrupted", "found unfinished after a restart");
      }
    }

    // 2. Brands that had no address or phone. Once Brand Brain has them, their
    //    creatives go back in the queue without anyone pressing anything.
    if (Date.now() - w.lastContactCheck > CONTACT_RECHECK_MS) {
      w.lastContactCheck = Date.now();
      const { data: blocked } = await admin
        .from("creative_uploads")
        .select("id, client_id")
        .eq("caption_status", "no_contact")
        .in("status", ["uploaded", "rejected"])
        .limit(200);
      const { contactGap } = await import("@/lib/caption-engine");
      const clients = [...new Set((blocked || []).map((b) => b.client_id as string | null).filter((x): x is string => !!x))];
      for (const c of clients) {
        if (await contactGap(c)) continue;
        const ids = (blocked || []).filter((b) => b.client_id === c).map((b) => b.id as string);
        const { data: moved } = await admin.from("creative_uploads").update({ caption_status: "pending", caption_error: null }).in("id", ids).eq("caption_status", "no_contact").select("id");
        out.requeued += moved?.length || 0;
      }
    }

    // 3. The queue: new uploads first in line by age, then failed ones whose
    //    wait is over.
    const { data: pending } = await admin
      .from("creative_uploads")
      .select("id")
      .eq("caption_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    const ids = (pending || []).map((p) => p.id as string);
    if (ids.length < limit) {
      const { data: failed } = await admin
        .from("creative_uploads")
        .select("id, caption_attempts, caption_updated_at")
        .eq("caption_status", "failed")
        .lt("caption_attempts", MAX_CAPTION_ATTEMPTS)
        .order("caption_updated_at", { ascending: true })
        .limit(20);
      for (const f of failed || []) {
        if (ids.length >= limit) break;
        const wait = BACKOFF_MS[Math.min(Number(f.caption_attempts || 0), BACKOFF_MS.length - 1)];
        const since = f.caption_updated_at ? Date.now() - new Date(f.caption_updated_at as string).getTime() : Infinity;
        if (since >= wait) ids.push(f.id as string);
      }
    }

    for (const id of ids) {
      out.picked++;
      const r = await generateCaption(id, { by: "auto" });
      if (r.ok) out.written++;
      else if (!r.busy) out.failed++;
    }
    return out;
  } finally {
    w.busy = false;
    // An upload that arrived while this sweep ran asked for one; start it now
    // rather than leave it for the next cron tick.
    if (w.again) { w.again = false; kickCaptions(2000); }
  }
}

/**
 * Start writing now rather than at the next sweep — called right after an
 * upload lands. Runs in the background and keeps going until the queue is
 * empty, so a batch of twelve does not wait twelve sweeps. Never throws.
 */
export function kickCaptions(delayMs = 1500): void {
  const w = state();
  if (w.timer) return;
  w.timer = setTimeout(async () => {
    w.timer = null;
    try {
      for (let round = 0; round < 25; round++) {
        const res = await processPendingCaptions(4);
        if (res.busy) return; // the running sweep sees `again` and the cron picks up the rest
        if (res.picked === 0) break;
      }
    } catch (err: unknown) {
      console.error("caption worker: sweep failed —", err instanceof Error ? err.message : err);
    }
  }, delayMs);
}
