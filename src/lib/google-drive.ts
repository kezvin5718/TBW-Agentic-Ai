import { google } from "googleapis";
import { Readable } from "stream";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { downloadAndStoreGeneratedMedia, uploadToSupabaseStorageDirect } from "@/lib/higgsfield-mcp";

// Least-privilege: the app can only see/manage files IT creates, never the rest of the user's Drive.
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];
const SETTINGS_KEY = "google_drive_credentials";
const ROOT_FOLDER_NAME = "TBW Images";

export function getBaseAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url || url.includes("localhost") || url.includes("0.0.0.0") || url.includes("next_public")) {
    return "https://bron.digital";
  }
  return url.trim().replace(/\/+$/, "");
}

export function getRedirectUri(): string {
  return `${getBaseAppUrl()}/api/integrations/google-drive/callback`;
}

export function isConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on the server.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export function getAuthUrl(): string {
  const oauth2 = getOAuthClient();
  // access_type offline + prompt consent → guarantees a refresh_token.
  return oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
}

interface DriveCreds {
  refresh_token_encrypted: string;
  email?: string;
  status: "connected" | "disconnected" | "error";
  error_message?: string;
  connected_at?: string;
}

async function loadCreds(): Promise<DriveCreds | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("agency_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  return (data?.value as DriveCreds) || null;
}

async function saveCreds(creds: DriveCreds): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("agency_settings").upsert({ key: SETTINGS_KEY, value: creds }, { onConflict: "key" });
}

export async function exchangeCodeAndSave(code: string): Promise<DriveCreds> {
  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app under your Google Account → Security → Third-party access, then reconnect.");
  }
  oauth2.setCredentials(tokens);

  let email: string | undefined;
  try {
    const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
    const info = await oauth2api.userinfo.get();
    email = info.data.email || undefined;
  } catch {
    /* email is best-effort */
  }

  // Google's consent screen lets people approve the sign-in but leave the Drive
  // permission unticked. That yields a perfectly valid token which 403s on the
  // first upload with "Insufficient Permission" — hours later, far from the
  // cause. Check it here, while the person is still in the flow.
  const granted = String(tokens.scope || "");
  if (!granted.includes("drive")) {
    throw new Error(
      "Connected, but Drive permission wasn't granted. On Google's consent screen there is a tick box for accessing Google Drive — it needs to be ticked. Press Connect again and allow that one."
    );
  }

  const creds: DriveCreds = {
    refresh_token_encrypted: encrypt(tokens.refresh_token),
    email,
    status: "connected",
    connected_at: new Date().toISOString(),
  };
  await saveCreds(creds);
  return creds;
}

export async function disconnectDrive(): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("agency_settings").delete().eq("key", SETTINGS_KEY);
}

export async function getDriveStatus(): Promise<{ connected: boolean; email?: string; status: string; configured: boolean; error?: string }> {
  const creds = await loadCreds();
  return {
    connected: !!creds && creds.status === "connected",
    email: creds?.email,
    status: creds?.status || "disconnected",
    configured: isConfigured(),
    error: creds?.error_message,
  };
}


/**
 * Google answers "invalid_grant" when a refresh token is no longer usable.
 *
 * The usual cause is an OAuth consent screen still in Testing, where Google
 * expires refresh tokens after seven days — so Drive works for a week after
 * every reconnect and then quietly stops. Access being revoked or the account
 * password changing does the same thing.
 *
 * Whatever the cause, the connection needs a human, so mark it broken rather
 * than letting every Drive call fail on its own with an opaque code.
 */
function isDeadGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant|Token has been expired or revoked/i.test(msg);
}

async function markDriveBroken(reason: string): Promise<void> {
  const creds = await loadCreds();
  if (!creds || creds.status === "error") return;
  await saveCreds({ ...creds, status: "error", error_message: reason });
}

/** A human explanation for a Drive failure, plus the action it needs. */
export function explainDriveError(err: unknown): string {
  if (isDeadGrant(err)) {
    return "Google has rejected the saved Drive connection. Reconnect Google Drive under Integrations — and if this keeps happening every week, the Google Cloud consent screen is still in Testing, where refresh tokens expire after 7 days; publishing it stops that.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/quota|storageQuotaExceeded/i.test(msg)) {
    return "Google Drive is out of space — free some up or upgrade the plan.";
  }
  if (/insufficient permission|insufficientPermissions|403/i.test(msg)) {
    return "The Drive connection is missing permission to write files. Disconnect Google Drive under Integrations, connect again, and make sure the Google Drive tick box is ticked on Google's consent screen — approving the sign-in alone is not enough.";
  }
  return msg;
}

async function getDriveService() {
  const creds = await loadCreds();
  if (!creds || creds.status !== "connected") return null;
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: decrypt(creds.refresh_token_encrypted) });
  const drive = google.drive({ version: "v3", auth: oauth2 });
  return drive;
}

// Drive API type is heavy; use a minimal structural type for the calls we make.
type DriveClient = NonNullable<Awaited<ReturnType<typeof getDriveService>>>;

async function findOrCreateFolder(drive: DriveClient, name: string, parentId?: string): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const clauses = [`name='${safeName}'`, "mimeType='application/vnd.google-apps.folder'", "trashed=false"];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const res = await drive.files.list({ q: clauses.join(" and "), fields: "files(id,name)", spaces: "drive" });
  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Failed to create Drive folder "${name}"`);
  return created.data.id;
}

/**
 * Uploads an image buffer to the user's Google Drive under
 * "TBW Images / {clientName} / {monthLabel} /", makes it link-viewable, and
 * returns the file id + a URL usable directly in an <img> tag.
 */
export async function uploadImageToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  clientName?: string,
  monthLabel?: string,
  rootFolder: string = ROOT_FOLDER_NAME
): Promise<{ fileId: string; viewUrl: string }> {
  const drive = await getDriveService();
  if (!drive) throw new Error("Google Drive is not connected.");

  let parent = await findOrCreateFolder(drive, rootFolder);
  if (clientName) parent = await findOrCreateFolder(drive, clientName, parent);
  if (monthLabel) parent = await findOrCreateFolder(drive, monthLabel, parent);

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id",
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error("Google Drive upload returned no file id.");

  // Make it viewable by anyone with the link (same posture as the current public bucket)
  // so the in-app gallery can display it.
  //
  // A failure here must not discard the upload: the bytes are already in Drive,
  // and throwing would both orphan that file and push a second copy into
  // Supabase. Log it and hand back the file we have.
  try {
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
  } catch (err) {
    console.error(`Drive: uploaded ${fileName} but could not make it link-viewable —`, err);
  }

  return { fileId, viewUrl: `https://lh3.googleusercontent.com/d/${fileId}` };
}

export async function isDriveConnected(): Promise<boolean> {
  const creds = await loadCreds();
  return !!creds && creds.status === "connected";
}


/**
 * Stores a file in Drive and refuses to fall back.
 *
 * storeFromBuffer quietly writes to Supabase when Drive misbehaves, which is
 * right for incidental media but wrong for generated creatives — Supabase has
 * no room for them, and a silent fallback hides the Drive problem instead of
 * surfacing it.
 */
export async function storeToDriveStrict(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  clientName?: string,
  monthLabel?: string,
  rootFolder: string = ROOT_FOLDER_NAME
): Promise<{ url: string | null; error?: string }> {
  if (!(await isDriveConnected())) {
    return { url: null, error: "Google Drive is not connected — connect it under Integrations." };
  }
  try {
    const { viewUrl } = await uploadImageToDrive(buffer, fileName, mimeType, clientName, monthLabel, rootFolder);
    return { url: viewUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Both of these mean the connection itself needs a human, so flag it rather
    // than letting every later call rediscover the same thing on its own.
    if (isDeadGrant(err)) {
      await markDriveBroken("Google rejected the saved refresh token (invalid_grant).");
    } else if (/insufficient permission|insufficientPermissions/i.test(msg)) {
      await markDriveBroken("Connected, but without permission to write files — the Drive tick box wasn't granted.");
    }
    return { url: null, error: explainDriveError(err) };
  }
}

/** Drive space, so a full account is visible before it breaks an upload. */
export async function getDriveQuota(): Promise<{ usedGb: number; limitGb: number | null; percent: number | null } | null> {
  const drive = await getDriveService();
  if (!drive) return null;
  try {
    // Needs broader scope than drive.file, so this legitimately returns nothing
    // on a least-privilege connection. Absence of a figure is not a problem.
    const res = await drive.about.get({ fields: "storageQuota" });
    const q = res.data.storageQuota;
    const used = Number(q?.usage || 0);
    const limit = q?.limit ? Number(q.limit) : null;
    return {
      usedGb: Number((used / 1024 ** 3).toFixed(2)),
      limitGb: limit ? Number((limit / 1024 ** 3).toFixed(2)) : null,
      percent: limit ? Math.round((used / limit) * 100) : null,
    };
  } catch {
    return null;
  }
}

/** Where call recordings are dropped, one subfolder per person. */
export const CALL_ROOT_FOLDER = "TBW Call Recordings";

/**
 * Makes (or finds) one person's recordings folder and hands back its link.
 *
 * Each person gets their own folder so a recording's owner is decided by where
 * it landed rather than inferred — the founder's calls never mix with a
 * manager's, which is what keeps the approval rules honest.
 */
export async function ensureCallFolder(personFolderName: string): Promise<{ folderId: string; folderUrl: string; rootUrl: string }> {
  const drive = await getDriveService();
  if (!drive) throw new Error("Google Drive is not connected — connect it in Integrations first.");

  const rootId = await findOrCreateFolder(drive, CALL_ROOT_FOLDER);
  const folderId = await findOrCreateFolder(drive, personFolderName, rootId);
  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    rootUrl: `https://drive.google.com/drive/folders/${rootId}`,
  };
}

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdTime: string;
}

/**
 * Audio and video files sitting in a folder, newest first.
 *
 * Phone recorders write .m4a, .mp3, .amr or .opus depending on the handset, and
 * some report no useful MIME at all, so match on extension as well as type —
 * the same lesson as the Content Hub picker.
 */
export async function listCallRecordings(folderId: string, limit = 25): Promise<DriveAudioFile[]> {
  const drive = await getDriveService();
  if (!drive) throw new Error("Google Drive is not connected.");

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,size,createdTime)",
    orderBy: "createdTime desc",
    pageSize: limit,
    spaces: "drive",
  });

  const audioish = /\.(m4a|mp3|wav|ogg|opus|amr|aac|webm|mp4|3gp|flac)$/i;
  return (res.data.files || [])
    .filter((f) => {
      const t = f.mimeType || "";
      if (t === "application/vnd.google-apps.folder") return false;
      return t.startsWith("audio") || t.startsWith("video") || audioish.test(f.name || "");
    })
    .map((f) => ({
      id: f.id as string,
      name: (f.name as string) || "recording",
      mimeType: (f.mimeType as string) || "audio/mpeg",
      sizeBytes: Number(f.size || 0),
      createdTime: (f.createdTime as string) || new Date().toISOString(),
    }));
}

/**
 * Parks a manually-uploaded recording in Drive so Supabase doesn't keep it.
 *
 * The browser can only upload to Supabase — it has no access to the server's
 * Drive credentials — so a manual upload lands there first. Once we've finished
 * with it, it belongs in Drive like everything else.
 */
export async function moveCallToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  personFolderName: string
): Promise<string | null> {
  const drive = await getDriveService();
  if (!drive) return null;
  try {
    const rootId = await findOrCreateFolder(drive, CALL_ROOT_FOLDER);
    const folderId = await findOrCreateFolder(drive, personFolderName, rootId);
    const created = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id",
    });
    return created.data.id || null;
  } catch (err) {
    console.error("Could not move the recording to Drive:", err);
    return null;
  }
}

/** Raw bytes of a Drive file by id — the API route, which works for audio. */
export async function downloadDriveFileById(fileId: string): Promise<Buffer | null> {
  const drive = await getDriveService();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(res.data as ArrayBuffer);
  } catch (err) {
    console.error("Drive download failed:", err);
    return null;
  }
}

/** Download a Drive file's raw bytes via the API (works for video, unlike lh3 links). */
export async function downloadDriveFileByUrl(url: string): Promise<Buffer | null> {
  const m = url.match(/googleusercontent\.com\/d\/([^=/?&]+)/) || url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  if (!m) return null;
  try {
    const drive = await getDriveService();
    if (!drive) return null;
    const res = await drive.files.get({ fileId: m[1], alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(res.data as ArrayBuffer);
  } catch (err) {
    console.warn("Drive file download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort delete of a Drive file we created, given its view URL. */
export async function deleteDriveFileByUrl(url: string): Promise<boolean> {
  const m = url.match(/googleusercontent\.com\/d\/([^=/?&]+)/) || url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  if (!m) return false;
  try {
    const drive = await getDriveService();
    if (!drive) return false;
    await drive.files.delete({ fileId: m[1] });
    return true;
  } catch (err) {
    console.warn("Drive file delete failed (record removed anyway):", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Store a Content Hub designer upload — Google Drive when connected (under
 * "TBW Content Hub / {client} / {month}"), otherwise Supabase fallback.
 * Returns a displayable URL, or null on failure.
 */
export async function storeContentHubUpload(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  clientName?: string,
  monthLabel?: string
): Promise<string | null> {
  if (await isDriveConnected()) {
    try {
      const { viewUrl } = await uploadImageToDrive(buffer, fileName, mimeType, clientName, monthLabel, "TBW Content Hub");
      return viewUrl;
    } catch (err) {
      console.error("Content Hub Drive upload failed, falling back to Supabase:", err);
    }
  }
  return uploadToSupabaseStorageDirect(fileName, buffer, mimeType);
}

/**
 * Store a generated image by URL: uploads to Google Drive when connected,
 * otherwise falls back to Supabase Storage. Returns a displayable URL.
 */
export async function storeFromUrl(resultUrl: string, prefix: string, clientName?: string, monthLabel?: string): Promise<string> {
  if (await isDriveConnected()) {
    try {
      const resp = await fetch(resultUrl);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = resp.headers.get("content-type") || "image/png";
        const ext = mime.includes("png") ? "png" : mime.includes("mp4") ? "mp4" : mime.includes("webp") ? "webp" : "jpg";
        const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { viewUrl } = await uploadImageToDrive(buf, fileName, mime, clientName, monthLabel);
        return viewUrl;
      }
    } catch (err) {
      console.error("Drive store (url) failed, falling back to Supabase:", err);
    }
  }
  return downloadAndStoreGeneratedMedia(resultUrl, prefix);
}

/**
 * Store a generated image already in memory (e.g. a branding composite): Drive
 * when connected, else Supabase. Returns a displayable URL (or null on failure).
 */
export async function storeFromBuffer(buffer: Buffer, fileName: string, mimeType: string, clientName?: string, monthLabel?: string): Promise<string | null> {
  if (await isDriveConnected()) {
    try {
      const { viewUrl } = await uploadImageToDrive(buffer, fileName, mimeType, clientName, monthLabel);
      return viewUrl;
    } catch (err) {
      console.error("Drive store (buffer) failed, falling back to Supabase:", err);
    }
  }
  return uploadToSupabaseStorageDirect(fileName, buffer, mimeType);
}

// ── Task attachments ────────────────────────────────────────────────────────
//
// A 500MB file must never pass through the portal: the browser uploads it
// straight to Drive over a resumable session this server opens. That needs a
// live access token and a folder id out here, which is all these add — the
// auth, refresh and folder logic above is reused, not rebuilt.

export const TASK_FILES_ROOT = "TBW Task Files";

/**
 * A live OAuth access token for the connected Drive account.
 *
 * The resumable-session handshake is a plain HTTPS call rather than a
 * googleapis client method, so it needs the bearer token itself. The refresh
 * is the same one every other call here goes through.
 */
export async function getDriveAccessToken(): Promise<string | null> {
  const creds = await loadCreds();
  if (!creds || creds.status !== "connected") return null;
  try {
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ refresh_token: decrypt(creds.refresh_token_encrypted) });
    const { token } = await oauth2.getAccessToken();
    return token || null;
  } catch (err) {
    if (isDeadGrant(err)) await markDriveBroken("Google rejected the saved refresh token (invalid_grant).");
    console.error("Drive: could not mint an access token —", err);
    return null;
  }
}

/** "TBW Task Files / <client, or General>" — created on first use. */
export async function ensureTaskFilesFolder(clientName?: string | null): Promise<string | null> {
  const drive = await getDriveService();
  if (!drive) return null;
  const root = await findOrCreateFolder(drive, TASK_FILES_ROOT);
  return findOrCreateFolder(drive, (clientName || "").trim() || "General", root);
}

/**
 * The same anyone-with-link reader grant every stored file here gets, so the
 * team can open an attachment without a Google account of their own.
 */
export async function shareFileWithLink(fileId: string): Promise<void> {
  const drive = await getDriveService();
  if (!drive) return;
  try {
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
  } catch (err) {
    console.error(`Drive: ${fileId} uploaded but could not be made link-viewable —`, err);
  }
}

/** Confirms an uploaded file really exists, and what Drive says it is. */
export async function getDriveFileMeta(
  fileId: string
): Promise<{ id: string; name: string; mimeType: string; size: number | null } | null> {
  const drive = await getDriveService();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, fields: "id,name,mimeType,size" });
    const f = res.data;
    if (!f?.id) return null;
    return { id: f.id, name: f.name || "", mimeType: f.mimeType || "", size: f.size ? Number(f.size) : null };
  } catch (err) {
    console.warn("Drive: file lookup failed —", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort delete by id — an attachment nothing references must not squat. */
export async function deleteDriveFileById(fileId: string): Promise<boolean> {
  const drive = await getDriveService();
  if (!drive) return false;
  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (err) {
    console.warn("Drive file delete failed (record removed anyway):", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * The link to open a Drive file with.
 *
 * Images get the lh3 form the rest of the app embeds directly. Everything else
 * — PDFs, zips, video — gets Drive's own viewer, because lh3 does not serve
 * those bytes (which is why downloadDriveFileByUrl exists at all).
 */
export function driveViewUrl(fileId: string, mimeType?: string | null): string {
  return (mimeType || "").startsWith("image/")
    ? `https://lh3.googleusercontent.com/d/${fileId}`
    : `https://drive.google.com/file/d/${fileId}/view`;
}
