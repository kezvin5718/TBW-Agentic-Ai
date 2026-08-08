import { createServiceRoleClient } from "@/lib/supabase/server";
import { downloadDriveFileById, moveCallToDrive } from "@/lib/google-drive";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { spawn } from "child_process";
import { writeFile, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Turns a recorded call into task drafts.
 *
 * Same shape as the WhatsApp bot: the model reads the conversation, frames the
 * work, and nothing reaches the board until a person approves it. What differs
 * is the input — an hour of audio rather than a burst of messages.
 *
 * Whisper refuses anything over 25MB, and an hour of phone audio is far past
 * that, so the file is first squeezed to 16kHz mono (speech loses nothing that
 * matters) and then split if it is still too big.
 */

const WHISPER_LIMIT_BYTES = 24 * 1024 * 1024; // a little under 25MB
const CHUNK_SECONDS = 900; // 15 minutes per piece, comfortably inside the limit

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => (code === 0 ? resolve(out || err) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-300)}`))));
    p.on("error", reject);
  });
}

/** Seconds of audio, read from the container's ffprobe. */
async function durationOf(path: string): Promise<number | null> {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
    const n = parseFloat(out.trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}

async function transcribeOne(path: string, apiKey: string): Promise<string> {
  const buf = await readFile(path);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buf)], "audio.mp3", { type: "audio/mpeg" }));
  form.append("model", "whisper-1");
  // The same steer the WhatsApp voice notes use — most calls here switch
  // between English, Hindi and Gujarati mid-sentence.
  form.append(
    "prompt",
    "Indian English with Hindi/Gujarati code-mixing (Hinglish). Jewellery and advertising terms: reel, thumbnail, caption, creative, campaign, kundan, polki, bridal set, necklace, Instagram, RecurPost."
  );

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper rejected the audio (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.text || "");
}

/**
 * Download, compress, split if needed, transcribe, stitch back together.
 *
 * A recording that lives in Drive is fetched through the Drive API rather than
 * a URL — Drive links don't serve raw bytes for media, the same trap that made
 * published videos come back as JPEG poster frames. Nothing is copied into
 * Supabase on the way.
 */
export async function transcribeCall(audioUrl: string, driveFileId?: string | null): Promise<{ text: string; seconds: number | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Transcription needs OPENAI_API_KEY on the server — add it to /opt/tbw-os/.env and redeploy.");
  }

  const base = join(tmpdir(), `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const rawPath = `${base}-raw`;
  const smallPath = `${base}.mp3`;
  const cleanup: string[] = [rawPath, smallPath];

  try {
    let raw: Buffer;
    if (driveFileId) {
      const fromDrive = await downloadDriveFileById(driveFileId);
      if (!fromDrive) throw new Error("Could not read the recording from Google Drive.");
      raw = fromDrive;
    } else {
      const resp = await fetch(audioUrl);
      if (!resp.ok) throw new Error(`Could not fetch the recording (${resp.status}).`);
      raw = Buffer.from(await resp.arrayBuffer());
    }
    await writeFile(rawPath, raw);

    const seconds = await durationOf(rawPath);

    // 16kHz mono at 32kbps — speech stays perfectly legible and an hour lands
    // around 14MB instead of ~60MB.
    await run("ffmpeg", ["-y", "-i", rawPath, "-ac", "1", "-ar", "16000", "-b:a", "32k", smallPath]);

    const { size } = await stat(smallPath);
    if (size <= WHISPER_LIMIT_BYTES) {
      return { text: await transcribeOne(smallPath, apiKey), seconds };
    }

    // Still too big — cut it into quarter-hour pieces and transcribe in order.
    const pattern = `${base}-part-%03d.mp3`;
    await run("ffmpeg", ["-y", "-i", smallPath, "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-c", "copy", pattern]);

    const parts: string[] = [];
    for (let i = 0; i < 40; i++) {
      const p = `${base}-part-${String(i).padStart(3, "0")}.mp3`;
      try {
        await stat(p);
        parts.push(p);
        cleanup.push(p);
      } catch {
        break;
      }
    }
    if (parts.length === 0) throw new Error("Could not split the recording for transcription.");

    const texts: string[] = [];
    for (const p of parts) texts.push(await transcribeOne(p, apiKey));
    return { text: texts.join(" ").trim(), seconds };
  } finally {
    await Promise.all(cleanup.map((p) => rm(p, { force: true }).catch(() => {})));
  }
}

interface DraftedTask {
  title: string;
  description: string;
  task_type: string;
  priority: string;
  suggested_assignee: string | null;
  client_name: string | null;
  quote: string;
}

const TASK_TYPES = ["copy", "image", "video", "ads", "design", "video_edit", "ai_video", "script", "planning", "packaging", "print", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

/**
 * Reads a transcript and writes one draft per genuine commitment.
 *
 * Deliberately conservative: a call is mostly discussion, and turning every
 * "we should maybe try reels" into a task would bury the real ones. Only things
 * someone actually committed to become drafts.
 */
export async function draftTasksFromCall(callId: string): Promise<{ created: number; skipped: string }> {
  const admin = createServiceRoleClient();

  const { data: call } = await admin.from("call_recordings").select("*").eq("id", callId).single();
  if (!call?.transcript?.trim()) return { created: 0, skipped: "No transcript to read." };

  const [{ data: clients }, { data: team }] = await Promise.all([
    admin.from("clients").select("id, name").is("archived_at", null),
    admin.from("team_members").select("name, role_title").eq("active", true),
  ]);

  const clientList = (clients || []).map((c) => c.name).join(", ");
  const teamList = (team || []).map((t) => `${t.name} (${t.role_title || "team"})`).join(", ");

  const system = `You read transcripts of calls at an Indian advertising agency and pull out the work that was actually committed to.

The agency's clients: ${clientList || "none on record"}.
The team: ${teamList || "none on record"}.

Rules:
- One entry per distinct piece of work. Not per sentence.
- Only genuine commitments — something a person said they would do, or was asked to do and agreed. Ignore musings, opinions, and things explicitly deferred.
- If nobody committed to anything, return an empty list. That is a perfectly good answer.
- Quote the exact words from the transcript that the task came from, so a human can check it.
- The transcript is auto-transcribed and switches between English, Hindi and Gujarati. Names are often mangled — match them to the client and team lists above where you reasonably can, and use null when you cannot.
- Write titles as plain instructions a designer or editor would understand.
- task_type must be one of: ${TASK_TYPES.join(", ")}.
- priority must be one of: ${PRIORITIES.join(", ")}.`;

  const prompt = `Call: "${call.title}"

Transcript:
${String(call.transcript).slice(0, 60000)}

Return STRICTLY this JSON:
{ "tasks": [ { "title": "...", "description": "...", "task_type": "...", "priority": "...", "suggested_assignee": "name or null", "client_name": "client name or null", "quote": "the words this came from" } ] }`;

  const raw = await complete({
    model: MODEL_SMART,
    system,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: true,
    maxTokens: 2500,
  });

  let clean = raw.trim();
  if (clean.startsWith("```")) clean = clean.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const parsed = safeJsonParse<{ tasks: DraftedTask[] }>(clean, { tasks: [] });
  const tasks = (parsed.tasks || []).filter((t) => t?.title?.trim());

  if (tasks.length === 0) {
    return { created: 0, skipped: "Nothing in this call was a commitment to do work." };
  }

  const byName = new Map((clients || []).map((c) => [c.name.toLowerCase(), c.id]));
  const rows = tasks.map((t) => {
    const named = t.client_name?.trim().toLowerCase();
    const matched = named ? byName.get(named) : undefined;
    return {
      source: "call",
      call_id: call.id,
      // Whoever recorded the call approves what comes out of it.
      owner_id: call.uploaded_by,
      group_name: call.title,
      client_id: matched || call.client_id || null,
      client_uncertain: !matched && !call.client_id,
      title: String(t.title).slice(0, 200),
      description: [t.description, t.quote ? `\n\nHeard as: “${t.quote}”` : ""].filter(Boolean).join(""),
      task_type: TASK_TYPES.includes(t.task_type) ? t.task_type : "other",
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      suggested_assignee: t.suggested_assignee?.trim() || null,
      source_message_ids: [],
      status: "pending",
    };
  });

  const { error } = await admin.from("wa_task_drafts").insert(rows);
  if (error) throw new Error(`Could not save the drafts: ${error.message}`);

  await admin.from("call_recordings").update({ drafts_created: rows.length }).eq("id", call.id);
  return { created: rows.length, skipped: "" };
}


/**
 * Moves a Supabase-hosted recording into the owner's Drive folder and drops the
 * Supabase copy. Best effort: if Drive is unavailable the recording simply
 * stays put rather than being lost.
 */
async function parkInDrive(callId: string): Promise<void> {
  const admin = createServiceRoleClient();
  const { data: call } = await admin
    .from("call_recordings")
    .select("id, audio_url, file_name, uploaded_by, drive_file_id")
    .eq("id", callId)
    .single();
  if (!call || call.drive_file_id) return;

  const marker = "/storage/v1/object/public/studio-outputs/";
  const at = String(call.audio_url).indexOf(marker);
  if (at === -1) return; // not ours to move

  const objectPath = String(call.audio_url).slice(at + marker.length);
  try {
    const resp = await fetch(call.audio_url);
    if (!resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());

    const { data: profile } = await admin.from("profiles").select("name, role").eq("id", call.uploaded_by).maybeSingle();
    const person = (profile?.name || "Staff").trim();
    const folderName = profile?.role === "founder" ? `${person} (Founder)` : person;

    const fileId = await moveCallToDrive(
      buf,
      call.file_name || `call-${callId}.mp3`,
      resp.headers.get("content-type") || "audio/mpeg",
      folderName
    );
    if (!fileId) return;

    await admin.from("call_recordings")
      .update({ drive_file_id: fileId, audio_url: `https://drive.google.com/file/d/${fileId}/view` })
      .eq("id", callId);
    await admin.storage.from("studio-outputs").remove([objectPath]);
  } catch (err) {
    console.error("Could not park the recording in Drive:", err);
  }
}

/** Transcribe then draft, recording failure on the row rather than throwing away. */
export async function processCall(callId: string): Promise<{ ok: boolean; created: number; message: string }> {
  const admin = createServiceRoleClient();
  const { data: call } = await admin.from("call_recordings").select("id, audio_url, drive_file_id").eq("id", callId).single();
  if (!call) return { ok: false, created: 0, message: "Recording not found." };

  await admin.from("call_recordings").update({ status: "transcribing", error: null }).eq("id", callId);

  try {
    const { text, seconds } = await transcribeCall(call.audio_url, call.drive_file_id);
    if (!text.trim()) {
      await admin.from("call_recordings").update({ status: "failed", error: "Nothing could be heard in this recording." }).eq("id", callId);
      return { ok: false, created: 0, message: "Nothing could be heard in this recording." };
    }
    await admin.from("call_recordings")
      .update({ transcript: text, duration_seconds: seconds, status: "transcribed" })
      .eq("id", callId);

    // A manual upload had to land in Supabase first — the browser cannot reach
    // the server's Drive credentials. Now that we're done reading it, move it to
    // Drive and free the space; Supabase has no room for hours of call audio.
    if (!call.drive_file_id) await parkInDrive(callId);

    const { created, skipped } = await draftTasksFromCall(callId);
    return {
      ok: true,
      created,
      message: created > 0 ? `${created} task${created > 1 ? "s" : ""} waiting for your approval.` : skipped,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("call_recordings").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", callId);
    return { ok: false, created: 0, message: msg };
  }
}
