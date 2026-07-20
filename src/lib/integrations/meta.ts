/**
 * Meta Marketing API Integration Module
 * Exposes methods to manage campaigns, ad sets, ads, creatives, and fetch performance reports.
 */

interface CreateCampaignParams {
  name: string;
  objective: "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_ENGAGEMENT" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS";
  status?: "ACTIVE" | "PAUSED";
}

interface FetchAdReportParams {
  datePreset?: string;
  level?: "campaign" | "adset" | "ad" | "account";
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
      console.error("Meta API call failed: all retries exhausted. Error:", error);
      throw error;
    }
    console.warn(`Meta API call failed. Retrying in ${delay}ms... (${retries} retries left). Error:`, error);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

/**
 * Common request helper for Meta Graph API
 */
async function sendMetaRequest(endpoint: string, method = "GET", params: Record<string, string | number | boolean | object> = {}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("Meta integration error: META_ACCESS_TOKEN is missing.");
    throw new Error("Missing Meta API configuration credentials");
  }

  const url = new URL(`https://graph.facebook.com/v18.0/${endpoint}`);
  
  // Append standard params
  url.searchParams.append("access_token", accessToken);
  Object.keys(params).forEach(key => {
    const val = params[key];
    url.searchParams.append(key, typeof val === "object" ? JSON.stringify(val) : String(val));
  });

  return retryWithBackoff(async () => {
    const response = await fetch(url.toString(), {
      method,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Meta API responded with an error:", data);
      throw new Error(`Meta API Error: ${data.error?.message || response.statusText}`);
    }

    return data;
  });
}

/**
 * Create a campaign on Meta Ads manager
 */
export async function createMetaCampaign({
  name,
  objective,
  status = "PAUSED",
}: CreateCampaignParams) {
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) {
    console.error("Meta integration error: META_AD_ACCOUNT_ID is missing.");
    throw new Error("Missing Meta ad account ID configuration");
  }

  // Meta expects account ID format: act_123456789
  const formattedAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const payload = {
    name,
    objective,
    status,
    special_ad_categories: "NONE",
  };

  return sendMetaRequest(`${formattedAccountId}/campaigns`, "POST", payload);
}

/**
 * Fetch insights/reporting data for the configured Meta Ad Account
 */
export async function fetchMetaInsights({
  datePreset = "last_30d",
  level = "campaign",
}: FetchAdReportParams = {}) {
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) {
    console.error("Meta integration error: META_AD_ACCOUNT_ID is missing.");
    throw new Error("Missing Meta ad account ID configuration");
  }

  const formattedAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  
  const params = {
    date_preset: datePreset,
    level,
    fields: "campaign_name,adset_name,ad_name,spend,impressions,clicks,inline_link_clicks,actions",
  };

  return sendMetaRequest(`${formattedAccountId}/insights`, "GET", params);
}

/**
 * Publish a photo or video to Instagram Business account
 */
export async function publishToInstagram({
  igBusinessId,
  accessToken,
  mediaUrl,
  caption,
  mediaType = "image"
}: {
  igBusinessId: string;
  accessToken: string;
  mediaUrl: string;
  caption: string;
  mediaType: "image" | "video";
}): Promise<{ platformPostId: string }> {
  // If sandbox / local simulation
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { platformPostId: `mock_ig_post_${Math.floor(Math.random() * 1000000)}` };
  }

  // 1. Create Media Container
  const containerParams: Record<string, string> = {
    caption,
  };
  if (mediaType === "video") {
    containerParams.media_type = "REELS";
    containerParams.video_url = mediaUrl;
  } else {
    containerParams.image_url = mediaUrl;
  }

  const containerUrl = new URL(`https://graph.facebook.com/v21.0/${igBusinessId}/media`);
  containerUrl.searchParams.append("access_token", accessToken);
  Object.keys(containerParams).forEach(k => containerUrl.searchParams.append(k, containerParams[k]));

  const containerRes = await fetch(containerUrl.toString(), { method: "POST" });
  const containerData = await containerRes.json();

  if (!containerRes.ok) {
    throw new Error(`Meta Media Container Error: ${containerData.error?.message || containerRes.statusText}`);
  }

  const containerId = containerData.id;

  // For video / Reels, Meta needs time to process the video.
  if (mediaType === "video") {
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000));
      const statusUrl = new URL(`https://graph.facebook.com/v21.0/${containerId}`);
      statusUrl.searchParams.append("access_token", accessToken);
      statusUrl.searchParams.append("fields", "status_code");
      const statusRes = await fetch(statusUrl.toString());
      const statusData = await statusRes.json();
      if (statusRes.ok && statusData.status_code === "FINISHED") {
        break;
      }
      attempts++;
    }
  }

  // 2. Publish Media Container
  const publishUrl = new URL(`https://graph.facebook.com/v21.0/${igBusinessId}/media_publish`);
  publishUrl.searchParams.append("access_token", accessToken);
  publishUrl.searchParams.append("creation_id", containerId);

  const publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  const publishData = await publishRes.json();

  if (!publishRes.ok) {
    throw new Error(`Meta Publish Error: ${publishData.error?.message || publishRes.statusText}`);
  }

  return { platformPostId: publishData.id };
}

/**
 * Publish a post to Facebook Page
 */
export async function publishToFacebookPage({
  pageId,
  accessToken,
  mediaUrl,
  caption,
  mediaType = "image"
}: {
  pageId: string;
  accessToken: string;
  mediaUrl: string;
  caption: string;
  mediaType: "image" | "video";
}): Promise<{ platformPostId: string }> {
  // If sandbox / local simulation
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { platformPostId: `mock_fb_post_${Math.floor(Math.random() * 1000000)}` };
  }

  const endpoint = mediaType === "video" ? "videos" : "photos";
  const url = new URL(`https://graph.facebook.com/v21.0/${pageId}/${endpoint}`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("caption", caption);
  url.searchParams.append(mediaType === "video" ? "file_url" : "url", mediaUrl);

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Facebook Page Publish Error: ${data.error?.message || res.statusText}`);
  }

  return { platformPostId: data.id || data.post_id };
}

/**
 * Upload image to client Meta Ad Account Media Library
 */
export async function uploadAdImage({
  adAccountId,
  accessToken,
  imageUrl,
}: {
  adAccountId: string;
  accessToken: string;
  imageUrl: string;
}): Promise<{ imageHash: string }> {
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { imageHash: `mock_hash_${Math.floor(Math.random() * 1000000)}` };
  }

  const formattedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${formattedId}/adimages`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("url", imageUrl);

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta Ad Image Upload Error: ${data.error?.message || res.statusText}`);
  }

  // Meta response format: { images: { "filename.jpg": { hash: "..." } } }
  const fileKey = Object.keys(data.images || {})[0];
  if (!fileKey || !data.images[fileKey]?.hash) {
    throw new Error("Meta Ad Image response did not return a valid hash");
  }

  return { imageHash: data.images[fileKey].hash };
}

/**
 * Upload video to client Meta Ad Account Media Library
 */
export async function uploadAdVideo({
  adAccountId,
  accessToken,
  videoUrl,
}: {
  adAccountId: string;
  accessToken: string;
  videoUrl: string;
}): Promise<{ videoId: string }> {
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { videoId: `mock_vid_${Math.floor(Math.random() * 1000000)}` };
  }

  const formattedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${formattedId}/advideos`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("file_url", videoUrl);

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta Ad Video Upload Error: ${data.error?.message || res.statusText}`);
  }

  return { videoId: data.id };
}

/**
 * Create Ad Set inside campaign
 */
export async function createMetaAdSet({
  adAccountId,
  accessToken,
  campaignId,
  name,
  dailyBudget,
  targeting,
}: {
  adAccountId: string;
  accessToken: string;
  campaignId: string;
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
}): Promise<{ id: string }> {
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { id: `mock_adset_${Math.floor(Math.random() * 1000000)}` };
  }

  const formattedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${formattedId}/adsets`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("campaign_id", campaignId);
  url.searchParams.append("name", name);
  url.searchParams.append("daily_budget", String(Math.round(dailyBudget * 100))); // Meta expects cents
  url.searchParams.append("billing_event", "IMPRESSIONS");
  url.searchParams.append("optimization_goal", "REACH");
  url.searchParams.append("targeting", JSON.stringify(targeting));
  url.searchParams.append("status", "PAUSED"); // Safety Rail: ALWAYS created in paused state!

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta Ad Set Creation Error: ${data.error?.message || res.statusText}`);
  }

  return { id: data.id };
}

/**
 * Create Ad Creative definition
 */
export async function createMetaAdCreative({
  adAccountId,
  accessToken,
  name,
  pageId,
  instagramActorId,
  caption,
  imageHash,
  videoId,
}: {
  adAccountId: string;
  accessToken: string;
  name: string;
  pageId: string;
  instagramActorId?: string;
  caption: string;
  imageHash?: string;
  videoId?: string;
}): Promise<{ id: string }> {
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { id: `mock_creative_${Math.floor(Math.random() * 1000000)}` };
  }

  const formattedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${formattedId}/adcreatives`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("name", name);

  // Build object story spec
  const storySpec: Record<string, unknown> = {
    page_id: pageId,
  };
  if (instagramActorId) {
    storySpec.instagram_actor_id = instagramActorId;
  }

  if (videoId) {
    storySpec.video_data = {
      video_id: videoId,
      image_url: "https://example.com/thumbnail.jpg",
      message: caption,
    };
  } else if (imageHash) {
    storySpec.link_data = {
      image_hash: imageHash,
      message: caption,
      link: "https://facebook.com/" + pageId,
    };
  } else {
    throw new Error("Either imageHash or videoId must be provided to create Ad Creative");
  }

  url.searchParams.append("object_story_spec", JSON.stringify(storySpec));

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta Ad Creative Creation Error: ${data.error?.message || res.statusText}`);
  }

  return { id: data.id };
}

/**
 * Instantiate paused Ad inside Ad Set
 */
export async function createMetaAd({
  adAccountId,
  accessToken,
  adSetId,
  creativeId,
  name,
}: {
  adAccountId: string;
  accessToken: string;
  adSetId: string;
  creativeId: string;
  name: string;
}): Promise<{ id: string }> {
  if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
    return { id: `mock_ad_${Math.floor(Math.random() * 1000000)}` };
  }

  const formattedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${formattedId}/ads`);
  url.searchParams.append("access_token", accessToken);
  url.searchParams.append("adset_id", adSetId);
  url.searchParams.append("name", name);
  url.searchParams.append("creative", JSON.stringify({ creative_id: creativeId }));
  url.searchParams.append("status", "PAUSED"); // Safety Rail: ALWAYS created in paused state!

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta Ad Creation Error: ${data.error?.message || res.statusText}`);
  }

  return { id: data.id };
}

