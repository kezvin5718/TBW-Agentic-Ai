import { google } from "googleapis";
import { Readable } from "stream";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";

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

export async function getDriveStatus(): Promise<{ connected: boolean; email?: string; status: string; configured: boolean }> {
  const creds = await loadCreds();
  return {
    connected: !!creds && creds.status === "connected",
    email: creds?.email,
    status: creds?.status || "disconnected",
    configured: isConfigured(),
  };
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
  monthLabel?: string
): Promise<{ fileId: string; viewUrl: string }> {
  const drive = await getDriveService();
  if (!drive) throw new Error("Google Drive is not connected.");

  let parent = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);
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
  await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });

  return { fileId, viewUrl: `https://lh3.googleusercontent.com/d/${fileId}` };
}

export async function isDriveConnected(): Promise<boolean> {
  const creds = await loadCreds();
  return !!creds && creds.status === "connected";
}
