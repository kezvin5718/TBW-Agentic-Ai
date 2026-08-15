import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeToDriveStrict, isDriveConnected } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** A carousel card is a product still — generous for a photo, far under a reel. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Kept out of the creative folders: these are ad-manager reference images. */
const ROOT_FOLDER = "TBW Catalogue Ad Copy";

/**
 * POST /api/ad-copy/upload  (multipart: file, clientName?)
 *
 * Puts one carousel image on Google Drive and returns its link.
 *
 * Deliberately Drive-only, via storeToDriveStrict: Supabase Storage is nearly
 * full and is only ever transient here, so a silent fallback would quietly
 * consume the space it can least afford. If Drive is down the upload fails
 * loudly instead.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isDriveConnected())) {
    return NextResponse.json(
      { error: "Google Drive is not connected — connect it under Settings → Integrations before uploading." },
      { status: 400 }
    );
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const clientName = (form.get("clientName") as string | null) || undefined;
  if (!file) return NextResponse.json({ error: "No file received" }, { status: 400 });
  if (!(file.type || "").startsWith("image/")) {
    return NextResponse.json({ error: `${file.name} is not an image — carousel cards must be stills.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)}MB — the limit is ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "card.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const monthLabel = new Date().toLocaleString("en-IN", { month: "short", year: "numeric" });

  const stored = await storeToDriveStrict(
    buffer,
    `${Date.now()}-${safeName}`,
    file.type || "image/jpeg",
    clientName,
    monthLabel,
    ROOT_FOLDER
  );
  if (!stored.url) {
    return NextResponse.json({ error: stored.error || "Google Drive upload failed." }, { status: 502 });
  }

  return NextResponse.json({ success: true, url: stored.url, name: file.name || safeName });
}
