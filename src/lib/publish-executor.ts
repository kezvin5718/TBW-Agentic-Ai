import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encryption";
import { publishToInstagram } from "@/lib/integrations/meta";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function executePublishForCreative(
  creativeId: string
): Promise<{ success: boolean; platformPostId?: string; error?: string }> {
  const supabase = await createClient();

  // 1. Fetch creative details
  const { data: creative, error: creativeErr } = await supabase
    .from("creatives")
    .select("*, tasks(*, monthly_plans(*, clients(*)))")
    .eq("id", creativeId)
    .single();

  if (creativeErr || !creative) {
    return { success: false, error: creativeErr?.message || "Creative not found" };
  }

  const client = creative.tasks?.monthly_plans?.clients;
  if (!client) {
    return { success: false, error: "Client relation not found on creative task" };
  }

  // 2. Fetch and decrypt client credentials
  const { data: creds, error: credsErr } = await supabase
    .from("client_credentials")
    .select("*")
    .eq("client_id", client.id)
    .maybeSingle();

  if (credsErr || !creds) {
    return { success: false, error: "Client Meta Graph credentials not configured in database" };
  }

  let accessToken = "";
  try {
    accessToken = decrypt(creds.meta_page_token_encrypted);
  } catch (decErr) {
    console.error("Meta decryption failure details:", decErr);
    return { success: false, error: "Failed to decrypt client Meta access token credentials" };
  }

  const igBusinessId = creds.ig_business_id;
  const caption = creative.caption || "Social Post";
  const mediaUrl = creative.media_url;
  const mediaType = creative.type === "video" ? "video" : "image";

  // 3. Execute publishing with retry policy (tries: 3 total)
  let attempts = 0;
  const maxTries = 3;
  let lastError = "";
  let platformPostId = "";
  
  while (attempts < maxTries) {
    try {
      const res = await publishToInstagram({
        igBusinessId,
        accessToken,
        mediaUrl,
        caption,
        mediaType,
      });
      platformPostId = res.platformPostId;
      break; // Success!
    } catch (err: unknown) {
      attempts++;
      lastError = err instanceof Error ? err.message : "Unknown Meta API error";
      console.warn(`Publishing attempt ${attempts} failed for creative ${creativeId}. Error: ${lastError}`);
      if (attempts < maxTries) {
        // Delay before retrying
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!platformPostId) {
    // Alert Founder
    try {
      const { data: founderProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("role", "founder")
        .limit(1)
        .maybeSingle();

      const founderPhone = founderProfile?.phone || "9999999999";
      await sendWhatsAppText({
        to: founderPhone,
        text: `⚠️ tbw-os Alert: Creative draft (ID: ${creativeId}) failed to auto-publish. Retried ${maxTries} times. Error: ${lastError}`,
      });
    } catch (alertErr) {
      console.error("Failed to dispatch WhatsApp error alert to founder:", alertErr);
    }

    // Log failure event to timeline
    await supabase.from("creative_timeline").insert({
      creative_id: creativeId,
      event_type: "publish_failed",
      status_from: "sent_to_client",
      status_to: "failed",
      actor_role: "system",
      notes: `Failed to publish to Instagram. Error after ${maxTries} attempts: ${lastError}`,
    });

    return { success: false, error: lastError };
  }

  // 4. Update creative row on success
  const { error: updateErr } = await supabase
    .from("creatives")
    .update({
      platform_post_id: platformPostId,
      published_at: new Date().toISOString(),
    })
    .eq("id", creativeId);

  if (updateErr) {
    return { success: false, error: `Published but failed to update creative row: ${updateErr.message}` };
  }

  // Log success event to timeline
  await supabase.from("creative_timeline").insert({
    creative_id: creativeId,
    event_type: "posted",
    status_from: "sent_to_client",
    status_to: "published",
    actor_role: "system",
    notes: `Successfully posted to Instagram Business account. Post ID: ${platformPostId}`,
  });

  // 5. Send WhatsApp notification confirmation to client group
  try {
    const captionFirstLine = caption.split("\n")[0] || "Social Post Draft";
    await sendWhatsAppText({
      to: client.whatsapp_group_id || "1234567890",
      text: `Posted: "${captionFirstLine}" ✅`,
    });
  } catch (waErr) {
    console.error("Failed to notify client group of successful publication:", waErr);
  }

  return { success: true, platformPostId };
}

export async function executePublishForScheduledPost(
  postId: string
): Promise<{ success: boolean; platformPostId?: string; error?: string }> {
  const supabase = await createClient();

  // 1. Fetch scheduled post details
  const { data: post, error: postErr } = await supabase
    .from("scheduled_posts")
    .select("*, clients(*)")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return { success: false, error: postErr?.message || "Scheduled post not found" };
  }

  const client = post.clients;
  if (!client) {
    return { success: false, error: "Client relation not found on scheduled post" };
  }

  // 2. Fetch and decrypt client credentials
  const { data: creds, error: credsErr } = await supabase
    .from("client_credentials")
    .select("*")
    .eq("client_id", client.id)
    .maybeSingle();

  if (credsErr || !creds) {
    return { success: false, error: "Client Meta Graph credentials not configured in database" };
  }

  let accessToken = "";
  try {
    accessToken = decrypt(creds.meta_page_token_encrypted);
  } catch (decErr) {
    console.error("Meta decryption failure details:", decErr);
    return { success: false, error: "Failed to decrypt client Meta access token credentials" };
  }

  const igBusinessId = creds.ig_business_id;
  const pageId = creds.meta_page_id;
  const caption = post.caption || "Social Post";
  const mediaUrl = post.media_url;
  
  const isVideo = mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm)/) || mediaUrl.includes("video");
  const mediaType = isVideo ? "video" : "image";
  const platform = post.platform;

  if (platform === "instagram" && !igBusinessId) {
    return { success: false, error: "Instagram Business ID not configured for this client" };
  }
  if (platform === "facebook" && !pageId) {
    return { success: false, error: "Facebook Page ID not configured for this client" };
  }

  // 3. Execute publishing with retry policy (tries: 3 total)
  let attempts = 0;
  const maxTries = 3;
  let lastError = "";
  let platformPostId = "";
  
  while (attempts < maxTries) {
    try {
      if (platform === "instagram") {
        const res = await publishToInstagram({
          igBusinessId,
          accessToken,
          mediaUrl,
          caption,
          mediaType,
        });
        platformPostId = res.platformPostId;
      } else {
        const { publishToFacebookPage } = await import("@/lib/integrations/meta");
        const res = await publishToFacebookPage({
          pageId,
          accessToken,
          mediaUrl,
          caption,
          mediaType,
        });
        platformPostId = res.platformPostId;
      }
      break; // Success!
    } catch (err: unknown) {
      attempts++;
      lastError = err instanceof Error ? err.message : "Unknown Meta API error";
      console.warn(`Manual publishing attempt ${attempts} failed for post ${postId}. Error: ${lastError}`);
      if (attempts < maxTries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  const newAttempts = (post.attempts || 0) + 1;
  
  if (!platformPostId) {
    // If it fails after all retries, set status to failed
    await supabase
      .from("scheduled_posts")
      .update({
        attempts: newAttempts,
        last_error: lastError,
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    // Alert Founder
    try {
      const { data: founderProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("role", "founder")
        .limit(1)
        .maybeSingle();

      const founderPhone = founderProfile?.phone || "9999999999";
      await sendWhatsAppText({
        to: founderPhone,
        text: `⚠️ tbw-os Alert: Scheduled post (ID: ${postId}) failed to publish to ${platform}. Retried ${maxTries} times. Error: ${lastError}`,
      });
    } catch (alertErr) {
      console.error("Failed to dispatch WhatsApp error alert to founder:", alertErr);
    }

    return { success: false, error: lastError };
  }

  // Update scheduled post row on success
  const { error: updateErr } = await supabase
    .from("scheduled_posts")
    .update({
      platform_post_id: platformPostId,
      published_at: new Date().toISOString(),
      status: "published",
      attempts: newAttempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (updateErr) {
    return { success: false, error: `Published but failed to update scheduled post row: ${updateErr.message}` };
  }

  // Send WhatsApp notification confirmation to client group
  try {
    const captionFirstLine = caption.split("\n")[0] || "Social Post Draft";
    await sendWhatsAppText({
      to: client.whatsapp_group_id || "1234567890",
      text: `Manual Post Published to ${platform}: "${captionFirstLine}" ✅`,
    });
  } catch (waErr) {
    console.error("Failed to notify client group of successful publication:", waErr);
  }

  return { success: true, platformPostId };
}
