import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 200 * 1024 * 1024;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-200)}`))));
    p.on("error", reject);
  });
}

async function fetchMedia(url: string): Promise<Buffer> {
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
    const b = await downloadDriveFileByUrl(url);
    if (b) return b;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the video (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * POST /api/social-publisher/frames
 * Body: { mediaUrl }             → { width, height, duration, frames:[{t, preview}] }
 *       { mediaUrl, t, full:true } → { dataUrl }  (full-resolution frame at t)
 *
 * Server-side ffmpeg extraction — works for any source (Google Drive, Supabase)
 * and any codec the browser can't decode, which is why the client-side approach
 * failed with "Could not load the video for frame extraction".
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { mediaUrl, t, full } = await request.json();
  if (!mediaUrl) return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });

  const base = join(tmpdir(), `frm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const inPath = `${base}.video`;
  const made: string[] = [inPath];

  try {
    const buf = await fetchMedia(mediaUrl);
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: `Video is ${(buf.length / 1024 / 1024).toFixed(0)}MB — too large for frame preview (max 200MB). Upload a thumbnail manually.` }, { status: 400 });
    }
    await writeFile(inPath, buf);

    // Probe duration + dimensions.
    let duration = 0;
    let width = 0;
    let height = 0;
    try {
      const probe = await run("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json", inPath,
      ]);
      const j = JSON.parse(probe) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
      width = j.streams?.[0]?.width || 0;
      height = j.streams?.[0]?.height || 0;
      duration = Number(j.format?.duration || 0);
    } catch {
      duration = 0;
    }

    // Single full-resolution frame (used when the user picks a frame).
    if (full) {
      const at = Math.max(0, Number(t) || 0);
      const outPath = `${base}-full.jpg`;
      made.push(outPath);
      await run("ffmpeg", ["-y", "-ss", String(at), "-i", inPath, "-frames:v", "1", "-q:v", "2", outPath]);
      const jpg = await readFile(outPath);
      return NextResponse.json({ success: true, dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}`, width, height });
    }

    // Preview strip — 8 evenly spaced frames, small.
    const N = 8;
    const dur = duration > 0.5 ? duration : 8;
    const frames: Array<{ t: number; preview: string }> = [];
    for (let i = 0; i < N; i++) {
      const at = Math.min(Math.max(0, dur - 0.15), (dur * (i + 0.5)) / N);
      const outPath = `${base}-${i}.jpg`;
      made.push(outPath);
      try {
        await run("ffmpeg", ["-y", "-ss", String(at), "-i", inPath, "-frames:v", "1", "-vf", "scale=240:-2", "-q:v", "6", outPath]);
        const jpg = await readFile(outPath);
        frames.push({ t: Number(at.toFixed(2)), preview: `data:image/jpeg;base64,${jpg.toString("base64")}` });
      } catch {
        /* skip unreadable frame */
      }
    }
    if (frames.length === 0) throw new Error("No frames could be read from this video.");

    return NextResponse.json({ success: true, width, height, duration: dur, frames });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Frame extraction failed" }, { status: 500 });
  } finally {
    await Promise.all(made.map((f) => rm(f, { force: true }).catch(() => {})));
  }
}
