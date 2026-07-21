import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, executeHiggsfieldMCPTool, parseMCPToolResponse } from "@/lib/higgsfield-mcp";
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

    const serviceSupabase = createServiceRoleClient();
    let fullPublicUrl: string | null = null;

    // 1. Try Supabase Storage upload first
    try {
      const bucket = "brand-assets";
      const storagePath = `higgsfield-refs/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: uploadErr } = await serviceSupabase.storage
        .from(bucket)
        .upload(storagePath, buffer, { contentType: file.type || "image/jpeg", upsert: true });

      if (!uploadErr) {
        const publicData = serviceSupabase.storage.from(bucket).getPublicUrl(storagePath);
        if (publicData?.data?.publicUrl) {
          fullPublicUrl = publicData.data.publicUrl;
        } else {
          const { data: signedData } = await serviceSupabase.storage.from(bucket).createSignedUrl(storagePath, 86400);
          fullPublicUrl = signedData?.signedUrl || null;
        }
      }
    } catch (stErr) {
      console.warn("⚠️ Supabase storage upload warning, fallback to local uploads:", stErr);
    }

    // 2. Fallback local public/uploads directory if storage upload unconfigured
    if (!fullPublicUrl) {
      const uploadDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      const uniqueName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const filePath = join(uploadDir, uniqueName);
      await writeFile(filePath, buffer);

      const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host") || "bron.digital";
      const protocol = request.headers.get("x-forwarded-proto") || "https";
      fullPublicUrl = `${protocol}://${hostHeader}/uploads/${uniqueName}`;
    }

    console.log(`⚙️ Higgsfield MCP [media_import_url]: Importing reference image via media_import_url tool...`);
    console.log(`📍 Public URL: ${fullPublicUrl}`);

    // 3. Call Higgsfield MCP media_import_url tool with public HTTPS URL (Requirement 1)
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

    // Log raw response per Requirement 1
    console.log(`⚙️ Higgsfield MCP [media_import_url RAW RESPONSE]:\n${JSON.stringify(importRes, null, 2)}`);

    const parsedImport = parseMCPToolResponse(importRes);
    const confirmedMediaId = (parsedImport.raw?.media_id || parsedImport.raw?.id || parsedImport.id || parsedImport.job_id) as string | undefined;

    // Requirement 2: Never fabricate placeholder IDs — fail loudly if import failed
    if (!confirmedMediaId) {
      const errMsg = parsedImport.error || parsedImport.failure_reason || "media_import_url failed to return a confirmed media_id";
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
