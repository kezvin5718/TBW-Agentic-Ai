import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import sharp from "sharp";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Pull one representative frame (t=1s) out of a video buffer with ffmpeg.
async function extractVideoFrame(buf: Buffer): Promise<Buffer> {
  const base = join(tmpdir(), `qc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const inPath = `${base}.mp4`;
  const outPath = `${base}.jpg`;
  try {
    await writeFile(inPath, buf);
    await new Promise<void>((resolve, reject) => {
      const p = spawn("ffmpeg", ["-y", "-ss", "1", "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
      let err = "";
      p.stderr.on("data", (d) => (err += String(d)));
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-160)}`))));
      p.on("error", reject);
    });
    return await readFile(outPath);
  } finally {
    rm(inPath, { force: true }).catch(() => {});
    rm(outPath, { force: true }).catch(() => {});
  }
}

async function fetchMediaBuffer(url: string): Promise<Buffer> {
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
    const b = await downloadDriveFileByUrl(url);
    if (b) return b;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`could not fetch media (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Verdict { verdict: "match" | "mismatch" | "unsure"; detected_brand: string; reason: string }

interface RosterClient { id: string; name: string; qc_allowed_brands: string[] | null }

const norm = (s: string) => s.trim().toLowerCase();

/**
 * DETECT mode — a festival creative from the batch uploader, dropped with no
 * client chosen. The question flips from "is this <client>?" to "which of our
 * clients is this?", and the answer is only ever a suggestion: qc_status stays
 * "unsure" because the person who picks the client at submit is what verifies
 * it. The one verdict that still bites is the festival one — a Holi creative
 * filed under Diwali fails here exactly as it does for a single upload, so it
 * can never be scheduled.
 */
async function detectFestivalBrand(
  row: { file_url: string; media_type: string },
  festivalName: string,
  roster: RosterClient[]
): Promise<{ status: "unsure" | "mismatch"; detected: string; detectedFestival: string; note: string }> {
  let status: "unsure" | "mismatch" = "unsure";
  let detected = "";
  let detectedFestival = "";
  let note = "";
  try {
    let buf = await fetchMediaBuffer(row.file_url);
    if (row.media_type === "video") {
      if (buf.length > 150 * 1024 * 1024) throw new Error("video too large for QC (>150MB)");
      buf = await extractVideoFrame(buf);
    }
    const small = await sharp(buf).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const dataUrl = `data:image/jpeg;base64,${small.toString("base64")}`;

    // Sister concerns are listed so a creative carrying only the sister's name
    // still lands on the client who owns it.
    const related = roster
      .filter((c) => (c.qc_allowed_brands || []).filter(Boolean).length > 0)
      .map((c) => `"${c.name}" also appears on creatives as: ${(c.qc_allowed_brands || []).filter(Boolean).join(", ")}`);

    const raw = await completeVision({
      purpose: "qc-checks",
      system: "You are a brand-QC checker for an ad agency. Look at the creative and identify which brand it belongs to using visible logos, brand names, product labels and text. Output ONLY JSON.",
      prompt: `This creative was uploaded with NO brand chosen. Decide which of the agency's clients it belongs to.
Agency clients: ${roster.map((c) => `"${c.name}"`).join(", ")}.
${related.length > 0 ? `${related.join("\n")}\n` : ""}
Return JSON exactly:
{ "detected_brand": "<one client name from the list, written exactly as listed, or 'unknown'>", "reason": "<one short line>", "detected_festival": "<the festival or occasion this creative is for, or 'unknown'>", "festival_verdict": "match" | "mismatch" | "unsure" }

Rules: name a client only when its logo, brand name or product labels are visible on the creative. If the branding belongs to a related name above, answer with the client it belongs to. "unknown" if no clear branding is visible or it matches none of the clients.

This was filed as a festival story for: "${festivalName}". Judge the occasion from greetings, deities, symbols, colours and any festival wording on the creative. "match" if it is for ${festivalName}. "mismatch" if it is clearly for a DIFFERENT festival or occasion. "unsure" if the creative carries no festival cue at all.`,
      imageDataUrl: dataUrl,
    });
    const v = safeJsonParse<{ detected_brand?: string; reason?: string; detected_festival?: string; festival_verdict?: string }>(
      raw,
      { detected_brand: "unknown", reason: "unparseable response" }
    );
    const seen = String(v.detected_brand || "").trim();
    note = v.reason || "";

    // Written as the roster spells it whenever it is one of ours, so the
    // screen's name → client lookup is an exact match rather than a guess. The
    // raw reading is kept only when it names nobody we know.
    const byName = seen ? roster.find((c) => norm(c.name) === norm(seen)) : undefined;
    const bySister = !byName && seen
      ? roster.filter((c) => (c.qc_allowed_brands || []).some((b) => b && norm(b) === norm(seen)))
      : [];
    detected = byName ? byName.name : bySister.length === 1 ? bySister[0].name : seen;

    detectedFestival = String(v.detected_festival || "");
    if (v.festival_verdict === "mismatch") {
      status = "mismatch";
      note = `Filed under "${festivalName}" but the creative looks like ${detectedFestival || "a different occasion"}. ${note}`.trim();
    }
    if (row.media_type === "video") note = `${note} (judged from a video frame)`.trim();
  } catch (err: unknown) {
    status = "unsure";
    note = `Check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { status, detected, detectedFestival, note };
}

/**
 * POST /api/content-hub/qc — Brand QC for pending Content Hub uploads.
 * Vision-AI looks at each image (logos / brand text) and checks it against the
 * client it was uploaded under; wrong-brand uploads get flagged "mismatch".
 * Videos are skipped (v1). Processes up to 10 per call.
 * Festival creatives uploaded without a client (the festival batch) run in
 * detect mode instead — see detectFestivalBrand.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data: rows } = await admin
    .from("creative_uploads")
    .select("id, file_url, file_name, media_type, content_type, client_id, batch_id, clients(name), festival_id, festivals(name)")
    .eq("qc_status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (!rows || rows.length === 0) return NextResponse.json({ success: true, checked: 0 });

  const { data: clients } = await admin.from("clients").select("id, name, qc_allowed_brands");
  const brandNames = (clients || []).map((c) => c.name);
  const allowedFor = new Map(
    (clients || []).map((c) => [c.id, ((c.qc_allowed_brands as string[] | null) || []).filter(Boolean)])
  );

  let checked = 0;
  let flagged = 0;
  let autoScheduled = 0;
  const touchedBatches = new Set<string>();
  // Fetched once, and only when a detect-mode row is in this sweep. Archived
  // clients are left out — the screen can't offer them in its dropdown either.
  let roster: RosterClient[] | null = null;

  for (const row of rows) {
    // No client on a festival creative means the batch uploader: detect, don't
    // verify. Its batch is deliberately NOT handed to the batch verdict — that
    // batch is ten different brands dropped together, not one delivery, so one
    // wrong-festival creative must not reject the other nine.
    if (row.festival_id && !row.client_id) {
      if (!roster) {
        const { data: live } = await admin.from("clients").select("id, name, qc_allowed_brands").is("archived_at", null);
        roster = (live || []) as RosterClient[];
      }
      const festName = (row.festivals as { name?: string } | null)?.name || "the festival";
      const d = await detectFestivalBrand(row, festName, roster);
      await admin
        .from("creative_uploads")
        .update({
          qc_status: d.status,
          qc_detected_brand: d.detected || null,
          qc_detected_festival: d.detectedFestival || null,
          qc_note: d.note || null,
        })
        .eq("id", row.id);
      checked++;
      continue;
    }

    const uploadedFor = (row.clients as { name?: string } | null)?.name || "Unknown";
    const festivalName = (row.festivals as { name?: string } | null)?.name || "";
    let detectedFestival = "";
    // Sister concerns and parent companies share artwork, so their names on a
    // creative are expected rather than evidence of the wrong brand.
    const sisters = allowedFor.get(row.client_id) || [];
    let status: Verdict["verdict"] | "unsure" = "unsure";
    let detected = "";
    let note = "";
    try {
      // Get an image to judge: the file itself, or a 1s frame for videos.
      let buf = await fetchMediaBuffer(row.file_url);
      if (row.media_type === "video") {
        if (buf.length > 150 * 1024 * 1024) throw new Error("video too large for QC (>150MB)");
        buf = await extractVideoFrame(buf);
      }
      const small = await sharp(buf).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const dataUrl = `data:image/jpeg;base64,${small.toString("base64")}`;

      // A festival story is also checked against the festival it was filed
      // under, because the expensive mistake there is a Diwali creative going
      // out on Holi — the branding can be perfectly correct while the greeting
      // is the wrong one entirely.
      const raw = await completeVision({
        purpose: "qc-checks",
        system: "You are a brand-QC checker for an ad agency. Look at the creative and identify which brand it belongs to using visible logos, brand names, product labels and text. Output ONLY JSON.",
        prompt: `This creative was uploaded for the brand: "${uploadedFor}".
Known agency brands: ${brandNames.join(", ")}.
${sisters.length > 0 ? `"${uploadedFor}" is related to: ${sisters.join(", ")}. Seeing those names on this creative is expected and correct.\n` : ""}
Identify the brand visible in this creative. Return JSON exactly:
{ "detected_brand": "<brand name you see, or 'unknown'>", "verdict": "match" | "mismatch" | "unsure", "reason": "<one short line>"${festivalName ? `, "detected_festival": "<the festival or occasion this creative is for, or 'unknown'>", "festival_verdict": "match" | "mismatch" | "unsure"` : ""} }

Rules: "match" if the visible branding belongs to "${uploadedFor}"${sisters.length > 0 ? ` or to any of its related brands (${sisters.join(", ")})` : ""}. "mismatch" if it clearly shows a DIFFERENT brand (especially one of the known brands). "unsure" if no clear branding is visible.${
  festivalName
    ? `\n\nThis was filed as a festival story for: "${festivalName}". Judge the occasion from greetings, deities, symbols, colours and any festival wording on the creative. "match" if it is for ${festivalName}. "mismatch" if it is clearly for a DIFFERENT festival or occasion. "unsure" if the creative carries no festival cue at all.`
    : ""
}`,
        imageDataUrl: dataUrl,
      });
      const v = safeJsonParse<Verdict>(raw, { verdict: "unsure", detected_brand: "unknown", reason: "unparseable response" });
      detected = v.detected_brand || "";
      note = v.reason || "";
      status = ["match", "mismatch", "unsure"].includes(v.verdict) ? v.verdict : "unsure";

      // Safety: if the model says match but names a different known brand, flag it.
      //
      // Only when the right brand is absent, though. Co-branded artwork —
      // "Royal Rose Fine Jewels by Anantam" — names both, and treating the
      // second name as evidence of the wrong brand overrode a correct verdict.
      if (status === "match" && detected && detected.toLowerCase() !== "unknown") {
        const seen = detected.toLowerCase();
        const namesTheRightBrand = seen.includes(uploadedFor.toLowerCase());
        const isSister = (b: string) => sisters.some((s) => s.toLowerCase() === b.toLowerCase());
        const other = brandNames.find(
          (b) => b.toLowerCase() !== uploadedFor.toLowerCase() && !isSister(b) && seen.includes(b.toLowerCase())
        );
        if (other && !namesTheRightBrand) {
          status = "mismatch";
          note = `Detected "${other}" but uploaded under "${uploadedFor}". ${note}`;
        } else if (other) {
          note = `Also shows "${other}" alongside ${uploadedFor}. ${note}`.trim();
        }
      }
      // The festival verdict can fail a creative whose branding is perfect.
      if (festivalName) {
        const fv = v as unknown as { detected_festival?: string; festival_verdict?: string };
        detectedFestival = String(fv.detected_festival || "");
        if (fv.festival_verdict === "mismatch") {
          status = "mismatch";
          note = `Filed under "${festivalName}" but the creative looks like ${detectedFestival || "a different occasion"}. ${note}`.trim();
        }
      }
      if (row.media_type === "video") note = `${note} (judged from a video frame)`.trim();
    } catch (err: unknown) {
      status = "unsure";
      note = `Check failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    await admin
      .from("creative_uploads")
      .update({
        qc_status: status,
        qc_detected_brand: detected || null,
        qc_detected_festival: detectedFestival || null,
        qc_note: note || null,
      })
      .eq("id", row.id);
    checked++;
    if (status === "mismatch") flagged++;

    // A festival story schedules itself the moment it passes — that is the
    // whole point of the section, that uploading is the only step. A failure
    // schedules nothing and stays visible instead.
    if (row.festival_id && status === "match") {
      try {
        const { scheduleFestivalStory } = await import("@/lib/festival-story");
        const res = await scheduleFestivalStory(row.id);
        if (res.scheduled > 0) autoScheduled += res.scheduled;
        for (const n of res.notes) console.warn(`festival story ${row.id}: ${n}`);
      } catch (err: unknown) {
        console.error(`festival story ${row.id} could not be scheduled:`, err);
      }
    }

    if (row.batch_id) touchedBatches.add(row.batch_id);
  }

  // Batch verdicts come after every row in this sweep has a result, because a
  // batch is only decided once all of its creatives have been judged.
  const { applyBatchVerdict } = await import("@/lib/upload-batch");
  let rejectedByBatch = 0;
  const rejectedBatches = new Set<string>();
  for (const batchId of touchedBatches) {
    const res = await applyBatchVerdict(batchId);
    if (res.rejected > 0) {
      rejectedByBatch += res.rejected;
      rejectedBatches.add(batchId);
      console.warn(`content hub: batch ${batchId} rejected — ${res.reason}`);
    }
  }

  // Captions are NOT written here any more. Passing QC no longer spends a
  // vision read and a writing call on every creative that happens to arrive —
  // captions are generated only when somebody asks for them, from the
  // Automation screen's ✨ / "Write all captions", or the composer.
  return NextResponse.json({ success: true, checked, flagged, autoScheduled, rejectedByBatch });
}
