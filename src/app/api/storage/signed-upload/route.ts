import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Hands the browser a short-lived ticket to upload one file straight to
 * Supabase Storage.
 *
 * Posting the bytes through this server instead meant holding the whole file
 * in memory three times over — once for the multipart parse, once for
 * arrayBuffer(), once for the Buffer copy. A 75MB reel spiked past 200MB and
 * the container was killed mid-request, which is what reached the browser as a
 * 502. Bytes now go browser → Supabase directly and never touch this process.
 *
 * The signed URL authorises exactly one upload to exactly one path, so the
 * anon key in the browser gains nothing beyond what it was handed here.
 */

/** Only these destinations may be requested — never a caller-supplied bucket. */
const DESTINATIONS: Record<string, { bucket: string; folder: string }> = {
  social: { bucket: "studio-outputs", folder: "social" },
  calls: { bucket: "studio-outputs", folder: "calls" },
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) {
    return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  }
  if (!["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const dest = DESTINATIONS[String(body.destination || "social")];
  if (!dest) return NextResponse.json({ error: "Unknown upload destination" }, { status: 400 });

  const rawName = String(body.fileName || "media");
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const path = `${dest.folder}/${Date.now()}-${safeName}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from(dest.bucket).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not start the upload." }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(dest.bucket).getPublicUrl(path);
  return NextResponse.json({
    success: true,
    bucket: dest.bucket,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: pub?.publicUrl || null,
  });
}
