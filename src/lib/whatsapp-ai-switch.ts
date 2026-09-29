import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * The WhatsApp AI's master switch.
 *
 * Everything WhatsApp-shaped that spends OpenRouter credits answers to this
 * one key: the task bot that turns client chats into drafts (Sonnet, the
 * expensive one), the webhook bot that classifies and drafts replies, and the
 * inbox extract pass. Messages are still received and stored while it is off —
 * switching it back on later picks up with full history, nothing is lost.
 *
 * The founder flips it from the WhatsApp Reader page; missing means ON,
 * because the feature predates the switch and silence must not change
 * behaviour for anyone else running this code.
 */

export const WHATSAPP_AI_KEY = "whatsapp_ai";

export async function isWhatsAppAiOn(): Promise<boolean> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.from("agency_settings").select("value").eq("key", WHATSAPP_AI_KEY).maybeSingle();
    const value = data?.value as { state?: string } | string | null;
    const state = typeof value === "string" ? value : value?.state;
    return String(state || "on").toLowerCase() !== "off";
  } catch {
    // If the answer cannot be read, spending nothing is the safe answer.
    return false;
  }
}
