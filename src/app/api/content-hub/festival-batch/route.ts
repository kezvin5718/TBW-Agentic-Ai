import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { storeContentHubUpload } from "@/lib/google-drive";
import { scheduleFestivalStory } from "@/lib/festival-story";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Ten at a time — a festival morning's worth, and what one QC sweep judges. */
const MAX_FILES = 10;
/** A submit covers one batch, with room for a retry of a couple of them. */
const MAX_SUBMIT = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAND_PICKED_RE = /(\s*·\s*)?client picked by hand \(QC saw: [^)]*\)/g;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden — designers/founders only" }, { status: 403 }), user: null };
  }
  return { error: null, user };
}

/**
 * POST (multipart) /api/content-hub/festival-batch — a festival's creatives for
 * many brands at once, with NO client chosen.
 *
 * Fields: `files[]` (up to 10) + `festivalId`, optionally `batchId` so a screen
 * sending one file per request (for per-file progress) keeps them together.
 *
 * Every row goes in client-less and QC-pending: QC's detect mode names the
 * brand, and the person submitting confirms it. Nothing here schedules — a
 * creative with no confirmed client has nowhere to post.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;
  const user = guard.user!;

  const form = await request.formData();
  const files = [...form.getAll("files[]"), ...form.getAll("files")].filter((f): f is File => f instanceof File);
  const festivalId = String(form.get("festivalId") || "").trim();
  const askedBatch = String(form.get("batchId") || "").trim();
  const batchId = UUID_RE.test(askedBatch) ? askedBatch : randomUUID();

  if (!festivalId) return NextResponse.json({ error: "Pick the festival first." }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Up to ${MAX_FILES} creatives at a time — this was ${files.length}.` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: festival } = await admin.from("festivals").select("id, name").eq("id", festivalId).maybeSingle();
  if (!festival) return NextResponse.json({ error: "That festival is not on the list any more." }, { status: 404 });

  // Same Drive layout as the Content Hub ("TBW Content Hub / {client} / {month}"),
  // but there is no client yet — so these sit under "Festivals" instead of
  // loose in the month folder.
  const monthLabel = new Date().toISOString().slice(0, 7);

  const uploads: unknown[] = [];
  const failed: Array<{ file_name: string; error: string }> = [];

  for (const file of files) {
    const mime = file.type || "application/octet-stream";
    const isVideo = mime.startsWith("video") || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(file.name);
    const isImage = mime.startsWith("image") || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name);
    if (!isVideo && !isImage) {
      failed.push({ file_name: file.name, error: "Not an image or a video." });
      continue;
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${Date.now()}-${safeName}`;
      const publicUrl = await storeContentHubUpload(buffer, fileName, mime, "Festivals", monthLabel);
      if (!publicUrl) throw new Error("Upload failed — check Google Drive / storage connection.");

      const { data: row, error } = await admin
        .from("creative_uploads")
        .insert({
          client_id: null,
          uploaded_by: user.id,
          file_url: publicUrl,
          file_name: file.name,
          file_size: buffer.length,
          media_type: isVideo ? "video" : "image",
          content_type: "story",
          // A Story carries no caption on either platform.
          caption: "",
          festival_id: festivalId,
          batch_id: batchId,
          status: "uploaded",
          qc_status: "pending",
        })
        .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)")
        .single();
      if (error) throw new Error(error.message);
      uploads.push(row);
    } catch (err: unknown) {
      failed.push({ file_name: file.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (uploads.length === 0) {
    return NextResponse.json({ error: failed.map((f) => `${f.file_name}: ${f.error}`).join("; "), failed }, { status: 500 });
  }
  return NextResponse.json({ success: true, batchId, uploads, failed });
}

/**
 * PATCH /api/content-hub/festival-batch — submit. Body: { rows: [{ id, clientId }] }
 *
 * The human's pick is the verification: it sets the client, marks QC passed,
 * and schedules each one as its festival's Story. Where the pick disagrees
 * with what QC saw, the note says so — the record stays honest about who
 * decided. A creative QC rejected for the wrong festival is refused here too,
 * whatever the screen sends.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  const input: Array<{ id: string; clientId: string }> = (Array.isArray(body?.rows) ? body.rows : [])
    .map((r: { id?: unknown; clientId?: unknown }) => ({ id: String(r?.id || "").trim(), clientId: String(r?.clientId || "").trim() }))
    .filter((r: { id: string }) => r.id);
  if (input.length === 0) return NextResponse.json({ error: "Nothing to submit." }, { status: 400 });
  if (input.length > MAX_SUBMIT) return NextResponse.json({ error: `Up to ${MAX_SUBMIT} at a time.` }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: found } = await admin
    .from("creative_uploads")
    .select("id, file_name, festival_id, status, qc_status, qc_detected_brand, qc_note")
    .in("id", input.map((r) => r.id));
  const byId = new Map((found || []).map((r) => [r.id as string, r]));

  // The screen blocks this already; the route does not rely on it.
  const missing = input.filter((r) => !r.clientId);
  if (missing.length > 0) {
    const names = missing.map((r) => (byId.get(r.id)?.file_name as string) || r.id);
    return NextResponse.json({ error: `Pick a client for: ${names.join(", ")}`, missing: names }, { status: 400 });
  }

  const { data: clientRows } = await admin.from("clients").select("id, name").in("id", [...new Set(input.map((r) => r.clientId))]);
  const clientName = new Map((clientRows || []).map((c) => [c.id as string, c.name as string]));

  const results: Array<{ id: string; file_name: string | null; scheduled: boolean; platforms: number; notes: string[] }> = [];
  const blocked = (id: string, file_name: string | null, note: string) =>
    results.push({ id, file_name, scheduled: false, platforms: 0, notes: [note] });

  for (const pick of input) {
    const row = byId.get(pick.id);
    if (!row) { blocked(pick.id, null, "That upload no longer exists."); continue; }
    const fileName = (row.file_name as string) || null;
    if (!row.festival_id) { blocked(pick.id, fileName, "This is not a festival creative."); continue; }
    if (row.status !== "uploaded") { blocked(pick.id, fileName, `Already ${row.status} — nothing to do.`); continue; }
    if (row.qc_status === "pending") { blocked(pick.id, fileName, "QC is still reading this one — try again in a moment."); continue; }
    if (row.qc_status === "mismatch") {
      blocked(pick.id, fileName, `QC rejected it — ${row.qc_note || "wrong festival"}. Fix the creative and upload it again.`);
      continue;
    }
    const name = clientName.get(pick.clientId);
    if (!name) { blocked(pick.id, fileName, "That client no longer exists."); continue; }

    const seen = String(row.qc_detected_brand || "").trim();
    const base = String(row.qc_note || "").replace(HAND_PICKED_RE, "").trim();
    const note =
      seen.toLowerCase() === name.trim().toLowerCase()
        ? base
        : `${base}${base ? " · " : ""}client picked by hand (QC saw: ${seen || "unknown"})`;

    const { error } = await admin
      .from("creative_uploads")
      .update({ client_id: pick.clientId, qc_status: "match", qc_note: note || null })
      .eq("id", pick.id);
    if (error) { blocked(pick.id, fileName, `Could not save the client: ${error.message}`); continue; }

    try {
      const res = await scheduleFestivalStory(pick.id);
      results.push({ id: pick.id, file_name: fileName, scheduled: res.scheduled > 0, platforms: res.scheduled, notes: res.notes });
    } catch (err: unknown) {
      blocked(pick.id, fileName, `Could not be scheduled: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    success: true,
    scheduled: results.filter((r) => r.scheduled).length,
    blocked: results.filter((r) => !r.scheduled).length,
    results,
  });
}
