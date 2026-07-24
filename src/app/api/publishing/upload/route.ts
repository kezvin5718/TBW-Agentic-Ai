import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadToSupabaseStorageDirect } from "@/lib/higgsfield-mcp";
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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uniqueName = `pub-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    // 1. Direct Supabase Storage REST API Upload
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

    console.log(`⚙️ Manual Post Direct Upload URL: ${fullPublicUrl}`);

    return NextResponse.json({
      success: true,
      mediaUrl: fullPublicUrl,
      fileName: file.name,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Direct publish upload error:", error);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}
