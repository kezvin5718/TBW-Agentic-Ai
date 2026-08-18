// TBW WhatsApp Group Reader (read-only) — Baileys.
//
// ⚠️ Uses the unofficial WhatsApp multi-device protocol. Run it with a DEDICATED
// number added to your client groups — never your main line. It ONLY reads group
// messages and writes them to the wa_inbox table. It never sends anything.
//
// It also publishes its live status + current QR to wa_reader_status, so you can
// link / re-link from the website (Dashboard → WhatsApp Reader) — no SSH needed.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, [PAIRING_NUMBER]
// Auth state persists in ./auth (mount a volume so you don't re-scan every restart).

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { createClient } from "@supabase/supabase-js";
import { rm } from "fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The portal stores media to Google Drive and runs vision/transcription — this
// container only ferries bytes to it. Without these two the reader still works,
// it just goes back to recording "has_media" and nothing else.
const PORTAL_URL = (process.env.PORTAL_URL || "").replace(/\/+$/, "");
const WA_BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET || "";
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // a creative, not someone's raw footage

let currentSock = null;
const groupNameCache = new Map();

async function setStatus(patch) {
  try {
    await supabase.from("wa_reader_status").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  } catch (e) {
    console.error("status write error:", e?.message || e);
  }
}

function extractText(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || "";
}
function hasMedia(msg) {
  const m = msg.message || {};
  return !!(m.imageMessage || m.videoMessage || m.documentMessage || m.audioMessage || m.stickerMessage);
}

// Stickers and one-off previews aren't creatives — only these four kinds are
// worth downloading and filing.
function mediaKind(msg) {
  const m = msg.message || {};
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage) return "document";
  return null;
}
function mediaBytesDeclared(msg) {
  const m = msg.message || {};
  const node = m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage;
  return Number(node?.fileLength || 0);
}
function mediaFileName(msg, kind) {
  const m = msg.message || {};
  const ext = { image: "jpg", video: "mp4", audio: "ogg", document: "bin" }[kind] || "bin";
  return m.documentMessage?.fileName || `whatsapp-${kind}.${ext}`;
}

/**
 * Download the file and hand it to the portal, which files it in Drive under
 * the right client and updates the message row. Failures are logged and left
 * behind — a creative that couldn't be fetched must never take the reader down.
 */
async function shipMedia(msg, waMessageId, kind) {
  if (!PORTAL_URL || !WA_BRIDGE_SECRET) return;
  try {
    const declared = mediaBytesDeclared(msg);
    if (declared > MAX_MEDIA_BYTES) {
      console.log(`   ↳ media skipped (${(declared / 1024 / 1024).toFixed(0)}MB > 50MB cap)`);
      return;
    }
    const buf = await downloadMediaMessage(msg, "buffer", {});
    if (!buf || buf.length === 0 || buf.length > MAX_MEDIA_BYTES) return;

    const form = new FormData();
    form.append("file", new Blob([buf]), mediaFileName(msg, kind));
    form.append("wa_message_id", waMessageId);
    form.append("media_kind", kind);
    const res = await fetch(`${PORTAL_URL}/api/wa/media`, {
      method: "POST",
      headers: { "x-wa-secret": WA_BRIDGE_SECRET },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) console.error(`   ↳ portal refused media (${res.status}): ${(await res.text()).slice(0, 120)}`);
    else console.log(`   ↳ 📎 ${kind} filed to Drive.`);
  } catch (e) {
    console.error("media ship error:", e?.message || e);
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, printQRInTerminal: false, markOnlineOnConnect: false });
  currentSock = sock;
  sock.ev.on("creds.update", saveCreds);

  if (process.env.PAIRING_NUMBER && !sock.authState.creds.registered) {
    const num = process.env.PAIRING_NUMBER.replace(/[^0-9]/g, "");
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(num);
        console.log(`\n🔑 PAIRING CODE: ${code}\n`);
        await setStatus({ status: "waiting_scan", pairing_code: code });
      } catch (e) { console.error("Pairing code request failed:", e?.message || e); }
    }, 3000);
  }

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      await setStatus({ status: "waiting_scan", qr });
      if (!process.env.PAIRING_NUMBER) {
        console.log("\nScan this QR (or open the website → WhatsApp Reader):\n");
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") {
      console.log("✅ WhatsApp reader connected. Listening to group messages…");
      await setStatus({ status: "connected", qr: null, pairing_code: null, last_seen_at: new Date().toISOString() });
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`⚠️ Connection closed (${code}).`, loggedOut ? "Logged out." : "Reconnecting…");
      await setStatus({ status: loggedOut ? "logged_out" : "reconnecting" });
      if (loggedOut) { await rm("./auth", { recursive: true, force: true }).catch(() => {}); }
      start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid || "";
        const isGroup = jid.endsWith("@g.us");
        const isDm = jid.endsWith("@s.whatsapp.net");
        // Groups and direct chats only — never statuses, broadcasts or channels.
        if (!isGroup && !isDm) continue;
        // In a group our own messages are noise; in a DM they are half the
        // conversation, so both directions are kept there.
        if (msg.key?.fromMe && !isDm) continue;
        const text = extractText(msg);
        if (!text && !hasMedia(msg)) continue;

        if (isGroup && !groupNameCache.has(jid)) {
          try { groupNameCache.set(jid, (await sock.groupMetadata(jid))?.subject || ""); }
          catch { groupNameCache.set(jid, ""); }
        }

        const senderNumber = isDm
          ? jid.split("@")[0]
          : (msg.key?.participant || "").split("@")[0] || null;

        // A DM sender joins the contact directory on first sight, as "new"
        // until someone in the portal names them — unknown numbers never make
        // tasks, they wait in the tray.
        if (isDm && senderNumber && !msg.key?.fromMe) {
          await supabase.from("wa_contacts").upsert(
            { number: senderNumber, push_name: msg.pushName || null, updated_at: new Date().toISOString() },
            { onConflict: "number" }
          );
        }

        const kind = mediaKind(msg);
        const row = {
          wa_message_id: msg.key?.id || `${jid}-${msg.messageTimestamp}`,
          group_jid: isGroup ? jid : jid,
          group_name: isGroup ? groupNameCache.get(jid) || null : null,
          sender_number: senderNumber,
          sender_name: msg.pushName || null,
          message_text: text || null,
          has_media: hasMedia(msg),
          is_dm: isDm,
          from_me: !!msg.key?.fromMe,
          media_kind: kind,
          received_at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        };
        const { error } = await supabase.from("wa_inbox").upsert(row, { onConflict: "wa_message_id", ignoreDuplicates: true });
        if (error) console.error("insert error:", error.message);
        else console.log(`📥 ${isDm ? `DM ${senderNumber}` : row.group_name || jid}: ${(text || "[media]").slice(0, 60)}`);

        // Ship the actual file after the row exists, so the portal has a row to
        // attach the Drive link to. Fire-and-forget: a slow video download must
        // not block the next message.
        if (kind && !msg.key?.fromMe) {
          shipMedia(msg, row.wa_message_id, kind).catch(() => {});
        }
      } catch (e) {
        console.error("message handler error:", e?.message || e);
      }
    }
  });
}

// Outbound: send what staff queued in the portal, one message per tick with a
// small random delay — paced like a person, never like a blaster. Nothing sends
// unless a wa_outbox row exists, and only the portal creates those.
let sendingNow = false;
setInterval(async () => {
  if (sendingNow || !currentSock?.user) return;
  sendingNow = true;
  try {
    const { data: rows } = await supabase
      .from("wa_outbox").select("*").eq("status", "queued")
      .order("created_at", { ascending: true }).limit(1);
    const job = rows?.[0];
    if (!job) return;

    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 6000));
    const jid = job.to_jid.includes("@") ? job.to_jid : `${job.to_jid.replace(/[^0-9]/g, "")}@s.whatsapp.net`;

    let content;
    if (job.media_url) {
      const res = await fetch(job.media_url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`media fetch failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_MEDIA_BYTES) throw new Error("media exceeds the 50MB send cap");
      content =
        job.media_kind === "video" ? { video: buf, caption: job.body || "" }
        : job.media_kind === "document" ? { document: buf, fileName: job.to_label || "file", caption: job.body || "" }
        : { image: buf, caption: job.body || "" };
    } else {
      content = { text: job.body || "" };
    }

    await currentSock.sendMessage(jid, content);
    await supabase.from("wa_outbox").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", job.id);
    console.log(`📤 sent to ${job.to_label || jid}`);
  } catch (e) {
    const { data: rows } = await supabase
      .from("wa_outbox").select("id").eq("status", "queued")
      .order("created_at", { ascending: true }).limit(1);
    if (rows?.[0]) {
      await supabase.from("wa_outbox").update({ status: "failed", error: String(e?.message || e).slice(0, 300) }).eq("id", rows[0].id);
    }
    console.error("outbox send error:", e?.message || e);
  } finally {
    sendingNow = false;
  }
}, 20000);

// Heartbeat + watch for a re-link request from the website.
setInterval(async () => {
  await setStatus({ last_seen_at: new Date().toISOString() });
  try {
    const { data } = await supabase.from("wa_reader_status").select("relink_requested").eq("id", 1).single();
    if (data?.relink_requested) {
      await supabase.from("wa_reader_status").update({ relink_requested: false }).eq("id", 1);
      console.log("🔄 Re-link requested from website — clearing session & restarting…");
      try { await currentSock?.logout(); } catch { /* ignore */ }
      await rm("./auth", { recursive: true, force: true }).catch(() => {});
      process.exit(0); // container restarts (--restart) → fresh QR appears on the website
    }
  } catch { /* ignore */ }
}, 12000);

start().catch((e) => { console.error("fatal:", e); process.exit(1); });
