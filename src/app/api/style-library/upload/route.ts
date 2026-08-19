import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { storeToDriveStrict } from "@/lib/google-drive";
import { STYLE_CATEGORIES } from "@/lib/style-library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fifty designs in one drop is the normal case, not the edge case.
export const maxDuration = 300;

const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // the 500MB cap on one upload
const ALLOWED = ["image/jpeg", "image/png", "application/pdf"];
const STYLE_ROOT = "TBW Style Library";

/**
 * POST — bulk upload old designs into one category. Files go to Drive
 * (never Supabase Storage), rows are created as `pending`, and extraction
 * happens afterwards in small batches so this request only moves bytes.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const category = String(form.get("category") || "");
  if (!(STYLE_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Pick a valid category first." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files in the upload." }, { status: 400 });

  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: `That upload is ${(total / 1024 / 1024).toFixed(0)}MB — the limit is 500MB per upload. Split it into smaller drops.` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
  let stored = 0;
  const errors: string[] = [];

  for (const file of files) {
    const mime = file.type || "";
    if (!ALLOWED.includes(mime)) {
      errors.push(`${file.name}: only JPG, PNG and PDF are accepted.`);
      continue;
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safe = (file.name || "design").replace(/[^a-zA-Z0-9._-]/g, "_");
      const { url, error } = await storeToDriveStrict(
        buffer,
        `${Date.now()}-${safe}`,
        mime,
        catLabel,
        undefined,
        STYLE_ROOT
      );
      if (!url) throw new Error(error || "Drive refused the file.");

      const { error: dbErr } = await admin.from("style_presets").insert({
        category,
        image_url: url,
        file_name: file.name || safe,
        mime,
        status: "pending",
        created_by: user.id,
      });
      if (dbErr) throw new Error(dbErr.message);
      stored++;
    } catch (err: unknown) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
    }
  }

  return NextResponse.json({
    success: stored > 0,
    stored,
    errors,
    message: stored > 0
      ? `${stored} design${stored === 1 ? "" : "s"} saved to Drive under ${STYLE_ROOT}/${catLabel}. Extraction starts now.`
      : "Nothing was stored.",
  }, { status: stored > 0 ? 200 : 502 });
}
