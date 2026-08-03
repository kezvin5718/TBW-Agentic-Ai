// TBW WhatsApp Group Reader (read-only) — Baileys.
//
// ⚠️ Uses the unofficial WhatsApp multi-device protocol. Run it with a DEDICATED
// number added to your client groups — never your main line. It ONLY reads group
// messages and writes them to the wa_inbox table. It never sends anything.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Auth state persists in ./auth (mount a volume so you don't re-scan every restart).

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const groupNameCache = new Map();

function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  );
}
function hasMedia(msg) {
  const m = msg.message || {};
  return !!(m.imageMessage || m.videoMessage || m.documentMessage || m.audioMessage || m.stickerMessage);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, printQRInTerminal: false, markOnlineOnConnect: false });

  sock.ev.on("creds.update", saveCreds);

  // Pairing-code login (easier over SSH than scanning a QR). Set PAIRING_NUMBER
  // to the dedicated number in full international format, digits only (e.g. 9198…).
  if (process.env.PAIRING_NUMBER && !sock.authState.creds.registered) {
    const num = process.env.PAIRING_NUMBER.replace(/[^0-9]/g, "");
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(num);
        console.log(`\n🔑 PAIRING CODE: ${code}\nOn the dedicated phone: WhatsApp → Settings → Linked Devices → Link a device → "Link with phone number instead" → enter this code.\n`);
      } catch (e) {
        console.error("Pairing code request failed:", e?.message || e);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && !process.env.PAIRING_NUMBER) {
      console.log("\nScan this QR with the DEDICATED WhatsApp number (Linked Devices → Link a device):\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log("✅ WhatsApp reader connected. Listening to group messages…");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`⚠️ Connection closed (${code}).`, loggedOut ? "Logged out — delete ./auth and re-scan." : "Reconnecting…");
      if (!loggedOut) start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid || "";
        if (!jid.endsWith("@g.us")) continue; // groups only
        if (msg.key?.fromMe) continue;

        const text = extractText(msg);
        if (!text && !hasMedia(msg)) continue;

        if (!groupNameCache.has(jid)) {
          try { groupNameCache.set(jid, (await sock.groupMetadata(jid))?.subject || ""); }
          catch { groupNameCache.set(jid, ""); }
        }

        const row = {
          wa_message_id: msg.key?.id || `${jid}-${msg.messageTimestamp}`,
          group_jid: jid,
          group_name: groupNameCache.get(jid) || null,
          sender_number: (msg.key?.participant || "").split("@")[0] || null,
          sender_name: msg.pushName || null,
          message_text: text || null,
          has_media: hasMedia(msg),
          received_at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        };

        const { error } = await supabase.from("wa_inbox").upsert(row, { onConflict: "wa_message_id", ignoreDuplicates: true });
        if (error) console.error("insert error:", error.message);
        else console.log(`📥 ${row.group_name || jid}: ${(text || "[media]").slice(0, 60)}`);
      } catch (e) {
        console.error("message handler error:", e?.message || e);
      }
    }
  });
}

start().catch((e) => { console.error("fatal:", e); process.exit(1); });
