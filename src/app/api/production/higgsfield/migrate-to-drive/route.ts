import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isDriveConnected, uploadImageToDrive } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/production/higgsfield/migrate-to-drive
 * One-time: moves existing Supabase-hosted studio images to Google Drive,
 * repoints the gallery record (and any branded-variant reference) to the Drive
 * URL, then deletes the Supabase copy to reclaim space. Founder only.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") {
    return NextResponse.json({ error: "Forbidden — founder only" }, { status: 403 });
  }
  if (!(await isDriveConnected())) {
    return NextResponse.json({ error: "Connect Google Drive first (Settings → Integrations)." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: rows, error } = await admin
    .from("studio_generations")
    .select("id, generated_image_url, created_at")
    .like("generated_image_url", "%studio-outputs%")
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let migrated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows || []) {
    const oldUrl = row.generated_image_url as string;
    try {
      const resp = await fetch(oldUrl);
      if (!resp.ok) throw new Error(`source fetch ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = resp.headers.get("content-type") || "image/png";
      const fileName = oldUrl.split("/studio-outputs/")[1]?.split("?")[0]?.split("/").pop() || `image-${row.id}.png`;
      const monthLabel = ((row.created_at as string) || "").slice(0, 7) || undefined;

      const { viewUrl } = await uploadImageToDrive(buf, fileName, mime, undefined, monthLabel);

      // Repoint this record and any branded-variant reference to the Drive URL.
      await admin.from("studio_generations").update({ generated_image_url: viewUrl }).eq("id", row.id);
      await admin.from("studio_generations").update({ branded_variant_url: viewUrl }).eq("branded_variant_url", oldUrl);

      // Reclaim the Supabase copy now that Drive holds it.
      const path = oldUrl.split("/studio-outputs/")[1]?.split("?")[0];
      if (path) {
        try {
          await admin.storage.from("studio-outputs").remove([path]);
        } catch {
          /* non-fatal — the record already points to Drive */
        }
      }
      migrated++;
    } catch (e: unknown) {
      failed++;
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ success: true, migrated, failed, remaining: (rows?.length || 0) - migrated, errors: errors.slice(0, 8) });
}
