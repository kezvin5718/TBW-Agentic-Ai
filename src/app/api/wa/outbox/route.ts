import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { toPublishableVideoUrl } from "@/lib/publishable-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Outbound WhatsApp, always through the queue.
 *
 * A row here is the ONLY way anything reaches a client group or DM — the reader
 * sends what staff queued and nothing else, one message every twenty-odd
 * seconds, paced like a person. Phase 3 (anything answering on its own) stays
 * off; this endpoint requires a signed-in staff member per message.
 */

// GET — recent outbound with status, newest first.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("wa_outbox")
    .select("*, clients(name), profiles:created_by(name)")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, outbox: data || [] });
}

// POST — queue one message.
// Body: { clientId?, toNumber?, body?, mediaUrl?, mediaKind? } — clientId sends
// to that client's mapped group; toNumber DMs a known contact.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clientId, toNumber, body, mediaUrl, mediaKind } = await request.json();
  if (!String(body || "").trim() && !mediaUrl) {
    return NextResponse.json({ error: "Give it a message or a file — there is nothing to send." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  let toJid = "";
  let toLabel = "";
  let resolvedClient: string | null = null;

  if (clientId) {
    const { data: client } = await admin.from("clients").select("id, name, whatsapp_group_id").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (!client.whatsapp_group_id) {
      return NextResponse.json({ error: `${client.name} has no WhatsApp group mapped — set whatsapp_group_id in Brand Brain.` }, { status: 400 });
    }
    toJid = client.whatsapp_group_id as string;
    toLabel = `${client.name} group`;
    resolvedClient = client.id as string;
  } else if (toNumber) {
    // DMs go only to numbers someone has already named — the directory is the
    // allowlist, so a typo'd number can't be messaged cold.
    const clean = String(toNumber).replace(/[^0-9]/g, "");
    const { data: contact } = await admin.from("wa_contacts").select("number, label, client_id, status").eq("number", clean).maybeSingle();
    if (!contact || contact.status !== "assigned") {
      return NextResponse.json({ error: "That number isn't a named contact. Assign it in the WhatsApp Reader tray first." }, { status: 400 });
    }
    toJid = clean;
    toLabel = contact.label || clean;
    resolvedClient = (contact.client_id as string) || null;
  } else {
    return NextResponse.json({ error: "Pick a client group or a named contact." }, { status: 400 });
  }

  // A Drive video link serves a poster frame, not the video — stage it first so
  // the reader fetches real bytes.
  let sendUrl = mediaUrl || null;
  if (sendUrl && mediaKind === "video") {
    const staged = await toPublishableVideoUrl(sendUrl);
    if (!staged.url) return NextResponse.json({ error: staged.error || "Could not prepare the video." }, { status: 502 });
    sendUrl = staged.url;
  }

  const { data: row, error } = await admin
    .from("wa_outbox")
    .insert({
      to_jid: toJid,
      to_label: toLabel,
      client_id: resolvedClient,
      body: String(body || "").trim() || null,
      media_url: sendUrl,
      media_kind: sendUrl ? (mediaKind || "image") : null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    queued: row.id,
    message: `Queued for ${toLabel}. The reader sends it within about a minute; status shows in the outbox list.`,
  });
}
