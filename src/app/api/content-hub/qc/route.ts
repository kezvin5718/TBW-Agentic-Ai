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

/**
 * POST /api/content-hub/qc — Brand QC for pending Content Hub uploads.
 * Vision-AI looks at each image (logos / brand text) and checks it against the
 * client it was uploaded under; wrong-brand uploads get flagged "mismatch".
 * Videos are skipped (v1). Processes up to 10 per call.
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
    .select("id, file_url, file_name, media_type, client_id, clients(name)")
    .eq("qc_status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (!rows || rows.length === 0) return NextResponse.json({ success: true, checked: 0 });

  const { data: clients } = await admin.from("clients").select("id, name");
  const brandNames = (clients || []).map((c) => c.name);

  let checked = 0;
  let flagged = 0;

  for (const row of rows) {
    const uploadedFor = (row.clients as { name?: string } | null)?.name || "Unknown";
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

      const raw = await completeVision({
        system: "You are a brand-QC checker for an ad agency. Look at the creative and identify which brand it belongs to using visible logos, brand names, product labels and text. Output ONLY JSON.",
        prompt: `This creative was uploaded for the brand: "${uploadedFor}".
Known agency brands: ${brandNames.join(", ")}.

Identify the brand visible in this creative. Return JSON exactly:
{ "detected_brand": "<brand name you see, or 'unknown'>", "verdict": "match" | "mismatch" | "unsure", "reason": "<one short line>" }

Rules: "match" only if the visible branding clearly belongs to "${uploadedFor}". "mismatch" if it clearly shows a DIFFERENT brand (especially one of the known brands). "unsure" if no clear branding is visible.`,
        imageDataUrl: dataUrl,
      });
      const v = safeJsonParse<Verdict>(raw, { verdict: "unsure", detected_brand: "unknown", reason: "unparseable response" });
      detected = v.detected_brand || "";
      note = v.reason || "";
      status = ["match", "mismatch", "unsure"].includes(v.verdict) ? v.verdict : "unsure";

      // Safety: if the model says match but names a different known brand, flag it.
      if (status === "match" && detected && detected.toLowerCase() !== "unknown") {
        const other = brandNames.find((b) => b.toLowerCase() !== uploadedFor.toLowerCase() && detected.toLowerCase().includes(b.toLowerCase()));
        if (other) { status = "mismatch"; note = `Detected "${other}" but uploaded under "${uploadedFor}". ${note}`; }
      }
      if (row.media_type === "video") note = `${note} (judged from a video frame)`.trim();
    } catch (err: unknown) {
      status = "unsure";
      note = `Check failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    await admin.from("creative_uploads").update({ qc_status: status, qc_detected_brand: detected || null, qc_note: note || null }).eq("id", row.id);
    checked++;
    if (status === "mismatch") flagged++;
  }

  return NextResponse.json({ success: true, checked, flagged });
}
