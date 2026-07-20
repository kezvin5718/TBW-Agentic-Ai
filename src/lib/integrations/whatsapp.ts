/**
 * WhatsApp Cloud API Integration Module
 * Exposes methods to communicate with customers/founders for approvals, notifications, and onboarding.
 */

import { createClient } from "@/lib/supabase/server";

interface SendTextMessageParams {
  to: string;
  text: string;
}

interface SendTemplateMessageParams {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: Record<string, unknown>[];
}

interface SendDocumentMessageParams {
  to: string;
  storageRef: string;
  caption?: string;
  filename?: string;
}

/**
 * Generic retry wrapper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) {
      console.error("WhatsApp API call failed: all retries exhausted. Error:", error);
      throw error;
    }
    console.warn(`WhatsApp API call failed. Retrying in ${delay}ms... (${retries} retries left). Error:`, error);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

/**
 * Common request helper for Meta/WhatsApp Graph API
 */
async function sendWhatsAppRequest(endpoint: string, payload: Record<string, unknown>) {
  const accessToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.warn("WhatsApp credentials missing. Simulating request in dev/local mode.");
    return { simulated: true, message_id: `sim-${Date.now()}` };
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/${endpoint}`;

  return retryWithBackoff(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("WhatsApp API responded with an error:", data);
      throw new Error(`WhatsApp API Error: ${data.error?.message || response.statusText}`);
    }

    return data;
  });
}

/**
 * Send a simple text message to a user
 */
export async function sendWhatsAppText({ to, text }: SendTextMessageParams) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  };

  return sendWhatsAppRequest("messages", payload);
}

/**
 * Send a template message (e.g., interactive approval button templates)
 */
export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = "en_US",
  components = [],
}: SendTemplateMessageParams) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components,
    },
  };

  return sendWhatsAppRequest("messages", payload);
}

/**
 * Send a document PDF to a user
 */
export async function sendWhatsAppDocument({
  to,
  storageRef,
  caption = "Attached Document",
  filename = "document.pdf",
}: SendDocumentMessageParams) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
  }

  // Construct public URL for the public brand-assets bucket
  const documentUrl = `${supabaseUrl}/storage/v1/object/public/brand-assets/${storageRef}`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link: documentUrl,
      caption,
      filename,
    },
  };

  return sendWhatsAppRequest("messages", payload);
}

/**
 * requestApproval: Sends template message, uploads document PDF link,
 * and creates a pending approvals row in DB
 */
export async function requestWhatsAppApproval({
  clientId,
  entityType,
  entityId,
  subject,
  pdfRef,
}: {
  clientId: string;
  entityType: "plan" | "creative" | "campaign";
  entityId: string;
  subject: string;
  pdfRef: string;
}) {
  const supabase = await createClient();

  // 1. Fetch client contact number
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("name, whatsapp_group_id, social_accounts")
    .eq("id", clientId)
    .single();

  if (clientErr || !client) {
    throw new Error(`Failed to find client for approval request: ${clientErr?.message}`);
  }

  // Determine destination number (group ID or social accounts custom wa)
  const to = client.whatsapp_group_id || ((client.social_accounts as Record<string, unknown> | null)?.whatsapp as string | undefined);
  if (!to) {
    throw new Error(`Client ${client.name} has no WhatsApp destination number registered.`);
  }

  // 2. Insert approvals row with status = pending
  const { data: approval, error: approvalErr } = await supabase
    .from("approvals")
    .insert({
      client_id: clientId,
      entity_type: entityType,
      entity_id: entityId,
      approver_role: "client",
      channel: "whatsapp",
      decision: "pending",
      feedback_text: `Pending client approval via WhatsApp for: ${subject}`,
    })
    .select()
    .single();

  if (approvalErr) {
    throw new Error(`Failed to create approvals record: ${approvalErr.message}`);
  }

  // 3. Send template alert
  try {
    await sendWhatsAppTemplate({
      to,
      templateName: "asset_approval_request",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: client.name },
            { type: "text", text: subject },
          ],
        },
      ],
    });

    // 4. Send document PDF
    await sendWhatsAppDocument({
      to,
      storageRef: pdfRef,
      caption: `PDF Document for ${subject}`,
      filename: `${subject.toLowerCase().replace(/\s+/g, "_")}.pdf`,
    });
  } catch (apiError) {
    console.error("WhatsApp API dispatch failed, approval logged as pending in DB:", apiError);
  }

  return approval;
}

/**
 * Downloads a media asset from the WhatsApp/Meta Cloud servers.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const accessToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!accessToken) {
    console.warn("WhatsApp credentials missing. Returning mock audio buffer in simulation mode.");
    return { buffer: Buffer.alloc(0), mimeType: "audio/ogg" };
  }

  try {
    // 1. Get the media URL from the Graph API
    const metadataUrl = `https://graph.facebook.com/v20.0/${mediaId}`;
    const metaRes = await fetch(metadataUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!metaRes.ok) {
      throw new Error(`Failed to retrieve WhatsApp media metadata: ${metaRes.statusText}`);
    }

    const metadata = await metaRes.json();
    const mediaUrl = metadata.url;
    const mimeType = metadata.mime_type || "audio/ogg";

    if (!mediaUrl) {
      throw new Error("No URL returned from WhatsApp media metadata API.");
    }

    // 2. Fetch the actual binary audio data from the Meta URL
    const fileRes = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!fileRes.ok) {
      throw new Error(`Failed to download WhatsApp media file: ${fileRes.statusText}`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  } catch (error) {
    console.error("downloadWhatsAppMedia error:", error);
    throw error;
  }
}

/**
 * Uploads binary media buffer (e.g. synthesized audio) to WhatsApp Cloud servers.
 */
export async function uploadWhatsAppMedia(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const accessToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.warn("WhatsApp credentials missing. Skipping media upload and returning simulated ID.");
    return "sim-media-id-123";
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/media`;

    const formData = new FormData();
    const file = new File([new Uint8Array(audioBuffer)], "reply.aac", { type: mimeType });
    formData.append("file", file);
    formData.append("type", mimeType);
    formData.append("messaging_product", "whatsapp");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`WhatsApp Media Upload failed: ${response.statusText} (${errText})`);
    }

    const data = await response.json();
    return data.id || "";
  } catch (error) {
    console.error("uploadWhatsAppMedia error:", error);
    throw error;
  }
}

/**
 * Sends an audio attachment (voice note) to a user.
 */
export async function sendWhatsAppAudio({ to, mediaId }: { to: string; mediaId: string }) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "audio",
    audio: {
      id: mediaId,
    },
  };

  return sendWhatsAppRequest("messages", payload);
}
