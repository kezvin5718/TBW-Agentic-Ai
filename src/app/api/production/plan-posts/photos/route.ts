import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { storeToDriveStrict } from "@/lib/google-drive";
import { cleanProductPhoto } from "@/lib/product-photo";
import { describeImageViaVision } from "@/lib/integrations/openai-images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 40 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST (multipart: planId, file) — one product photo, straight to Drive.
 *
 * These used to detour through Supabase Storage before the cleaned copy went
 * to Drive — and Supabase is the one store in this system that is both nearly
 * full and meant to be transient, so the detour was where uploads went to die.
 * The house rule is that media lives on Google Drive; now the product photos
 * obey it: bytes in, cleaned, filed on Drive, described for pairing, done.
 * One file per request, so the page can show honest per-file progress.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const planId = String(form.get("planId") || "");
  const file = form.get("file");
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file in the upload." }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `${file.name}: only JPG, PNG or WebP product photos.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)}MB — keep product photos under 40MB.` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: plan } = await admin.from("monthly_plans").select("client_id").eq("id", planId).single();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const { data: clientRow } = await admin.from("clients").select("name").eq("id", plan.client_id).maybeSingle();

  const original = Buffer.from(await file.arrayBuffer());

  // Strip borders, logos and taglines — designers hand over finished posts,
  // and building on one produces the double-branded result QC rejects.
  let useBuffer: Buffer = original;
  let cleanNote = "";
  let needsHuman = false;
  let outName = (file.name || "product").replace(/[^a-zA-Z0-9._-]/g, "_");
  let outMime = file.type;
  try {
    const cleaned = await cleanProductPhoto(original);
    cleanNote = cleaned.note;
    needsHuman = cleaned.needsHuman;
    if (cleaned.changed) {
      useBuffer = cleaned.buffer;
      outName = `clean-${outName.replace(/\.[a-z0-9]+$/i, "")}.png`;
      outMime = "image/png";
    }
  } catch (err: unknown) {
    cleanNote = `could not clean the photo: ${err instanceof Error ? err.message : String(err)}`;
  }

  const stored = await storeToDriveStrict(
    useBuffer, `${Date.now()}-${outName}`, outMime,
    clientRow?.name || undefined, "product-photos", "TBW Generated Posts"
  );
  if (!stored.url) {
    return NextResponse.json({ error: stored.error || "Google Drive refused the photo." }, { status: 502 });
  }

  // Describe from the bytes in hand — never by handing the provider a Drive
  // link it may not be able to fetch. Downscaled: pairing needs the gist.
  let description = "";
  try {
    const sharp = (await import("sharp")).default;
    const small = await sharp(useBuffer).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    description = await describeImageViaVision(
      `data:image/jpeg;base64,${small.toString("base64")}`,
      "Describe this jewellery or product photograph in under 25 words: what the piece is, its metal and stones, and the occasion it suits."
    );
  } catch { /* pairing falls back to order */ }

  const { data: last } = await admin.from("plan_product_photos").select("seq").eq("plan_id", planId).order("seq", { ascending: false }).limit(1);
  const { error } = await admin.from("plan_product_photos").insert({
    plan_id: planId,
    client_id: plan.client_id,
    seq: (last?.[0]?.seq ?? 0) + 1,
    image_url: stored.url,
    file_name: file.name || outName,
    description: description || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, cleaned: outName.startsWith("clean-"), needsHuman, note: cleanNote, url: stored.url });
}
