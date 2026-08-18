import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { storeToDriveStrict } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/wa/media  (multipart: file, wa_message_id, media_kind)
 *
 * The wa-reader container ferries a client-sent file here; this side files it
 * in Drive under the right client and month, attaches the link to the message
 * row, and reads it — vision for stills and video, transcription for voice —
 * so the task that reaches the team says what the client actually sent instead
 * of "[media]".
 *
 * Auth is a shared secret, not a user session: the caller is a headless
 * container, and this endpoint accepts nothing but bytes for an existing
 * message row it names.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WA_BRIDGE_SECRET;
  if (!secret) return NextResponse.json({ error: "WA_BRIDGE_SECRET is not set on the server" }, { status: 503 });
  if (request.headers.get("x-wa-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const waMessageId = (form.get("wa_message_id") as string | null) || "";
  const kind = (form.get("media_kind") as string | null) || "document";
  if (!file || !waMessageId) return NextResponse.json({ error: "file and wa_message_id required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "over the 50MB cap" }, { status: 413 });

  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("wa_inbox")
    .select("id, group_jid, group_name, sender_number, sender_name, is_dm, received_at")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "no such message row" }, { status: 404 });

  // Whose client folder this belongs in: the group mapping for group messages,
  // the contact directory for DMs. Unmapped either way still gets filed — under
  // the group's own name or the bare number — so nothing is lost while waiting
  // for someone to assign it.
  let clientName: string | undefined;
  if (row.is_dm && row.sender_number) {
    const { data: contact } = await admin
      .from("wa_contacts").select("label, clients(name)").eq("number", row.sender_number).maybeSingle();
    clientName = (contact?.clients as { name?: string } | null)?.name || contact?.label || `DM ${row.sender_number}`;
  } else if (row.group_jid) {
    const { data: client } = await admin
      .from("clients").select("name").eq("whatsapp_group_id", row.group_jid).maybeSingle();
    clientName = client?.name || row.group_name || undefined;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const when = new Date(row.received_at as string);
  const stamp = when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/[ ,:]+/g, "-");
  const who = (row.sender_name || row.sender_number || "unknown").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 24);
  const safeName = (file.name || `media.${kind}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const monthLabel = when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" });

  const stored = await storeToDriveStrict(
    buffer,
    `${stamp}-${who}-${safeName}`,
    file.type || "application/octet-stream",
    clientName,
    monthLabel,
    "TBW WhatsApp Media"
  );
  if (!stored.url) return NextResponse.json({ error: stored.error || "Drive refused the upload" }, { status: 502 });

  // Best-effort reading. A failed description still leaves the file filed and
  // linked; the note is the upgrade, not the requirement.
  let note = "";
  try {
    if (kind === "audio") {
      const { transcribeAudio } = await import("@/lib/integrations/stt");
      const text = await transcribeAudio(buffer, file.type || "audio/ogg");
      if (text) note = `Voice note: "${text.slice(0, 600)}"`;
    } else if (kind === "image" || kind === "video") {
      const { readCreative } = await import("@/lib/creative-reader");
      const reading = await readCreative(stored.url, kind);
      note = [reading.description, reading.onCreativeText ? `Text on it: ${reading.onCreativeText}` : ""]
        .filter(Boolean).join(" · ").slice(0, 700);
    }
  } catch (err: unknown) {
    console.error(`wa media note failed for ${waMessageId}:`, err instanceof Error ? err.message : err);
  }

  await admin
    .from("wa_inbox")
    .update({ media_url: stored.url, media_kind: kind, media_note: note || null })
    .eq("id", row.id);

  return NextResponse.json({ success: true, url: stored.url, noted: !!note });
}
