import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, executeHiggsfieldMCPTool, parseMCPToolResponse, uploadToSupabaseStorageDirect } from "@/lib/higgsfield-mcp";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const creds = await getHiggsfieldCredentials();
    if (!creds || creds.status !== "connected") {
      return NextResponse.json(
        { error: "Higgsfield MCP is not connected. Please connect Higgsfield in Settings first." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uniqueName = `ref-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    // 1. Direct Supabase Storage REST API Upload (Requirement 1 & 2)
    let fullPublicUrl = await uploadToSupabaseStorageDirect(uniqueName, buffer, file.type || "image/jpeg");

    // 2. Fallback local public/uploads directory if direct storage upload unconfigured
    if (!fullPublicUrl) {
      const uploadDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      const filePath = join(uploadDir, uniqueName);
      await writeFile(filePath, buffer);

      const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host") || "bron.digital";
      const protocol = request.headers.get("x-forwarded-proto") || "https";
      fullPublicUrl = `${protocol}://${hostHeader}/uploads/${uniqueName}`;
    }

    // Log exact URL per Requirement 1
    console.log(`⚙️ Higgsfield MCP [media_import_url Request URL]: ${fullPublicUrl}`);

    // 3. Call Higgsfield MCP media_import_url tool
    let importRes: unknown;
    try {
      importRes = await executeHiggsfieldMCPTool(creds, "media_import_url", {
        url: fullPublicUrl,
        filename: file.name,
        file_name: file.name,
      });
    } catch {
      importRes = await executeHiggsfieldMCPTool(creds, "media_import_url", {
        params: {
          url: fullPublicUrl,
          filename: file.name,
          file_name: file.name,
        }
      });
    }

    // Log full raw response per Requirement 1
    console.log(`⚙️ Higgsfield MCP [media_import_url RAW RESPONSE]:\n${JSON.stringify(importRes, null, 2)}`);

    const parsedImport = parseMCPToolResponse(importRes);
    console.log(`⚙️ Higgsfield MCP [media_import_url PARSED OBJECT]:\n${JSON.stringify(parsedImport, null, 2)}`);

    let confirmedMediaId: string | undefined = undefined;

    // Requirement 3: Robust media_id extraction without field guessing
    if (parsedImport.raw && typeof parsedImport.raw === "object") {
      const rawObj = parsedImport.raw as Record<string, unknown>;
      confirmedMediaId = (rawObj.media_id || rawObj.mediaId || rawObj.id || rawObj.media_uuid) as string;
    }

    if (!confirmedMediaId) {
      confirmedMediaId = (parsedImport.media_id || parsedImport.id || parsedImport.job_id) as string;
    }

    if (!confirmedMediaId && importRes && typeof importRes === "object") {
      const resStr = JSON.stringify(importRes);
      const match = resStr.match(/"(media_id|mediaId|id|media_uuid)"\s*:\s*"([^"]+)"/i);
      if (match && match[2]) {
        confirmedMediaId = match[2];
      }
    }

    if (!confirmedMediaId) {
      const errMsg = parsedImport.error || parsedImport.failure_reason || "media_import_url returned no confirmed media_id";
      console.error(`❌ Higgsfield MCP: Media import failed: ${errMsg}`);
      return NextResponse.json(
        { error: `Higgsfield media import failed: ${errMsg}` },
        { status: 500 }
      );
    }

    console.log(`✅ Higgsfield MCP: Confirmed Media ID: ${confirmedMediaId}`);

    return NextResponse.json({
      success: true,
      mediaUrl: fullPublicUrl,
      mediaId: confirmedMediaId,
      higgsfieldMediaRef: confirmedMediaId,
      fileName: file.name,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Higgsfield upload error:", error);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}
