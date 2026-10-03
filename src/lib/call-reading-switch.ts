import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Call reading's master switch — the sibling of the WhatsApp one.
 *
 * Everything that turns a call recording into money answers to this key: the
 * Whisper transcription when a recording is processed, and the watch-folder
 * sweep that goes looking for recordings on its own. Uploading a file is
 * never blocked — a recording can sit stored until the switch comes back on.
 *
 * Missing means ON, because silence must not change behaviour for anyone
 * else running this code; the founder's row says off.
 */

export const CALL_READING_KEY = "call_reading";

export async function isCallReadingOn(): Promise<boolean> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.from("agency_settings").select("value").eq("key", CALL_READING_KEY).maybeSingle();
    const value = data?.value as { state?: string } | string | null;
    const state = typeof value === "string" ? value : value?.state;
    return String(state || "on").toLowerCase() !== "off";
  } catch {
    // If the answer cannot be read, spending nothing is the safe answer.
    return false;
  }
}
