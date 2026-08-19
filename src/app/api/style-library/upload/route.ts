import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
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

const GRID_LAYOUTS: Record<string, [number, number]> = {
  "3x3": [3, 3], "2x2": [2, 2], "3x2": [3, 2], "2x3": [2, 3], "3x4": [3, 4], "4x3": [4, 3],
};

/**
 * Guess the grid from the composite's shape, assuming Instagram-ish tiles
 * (square or 4:5 portrait). Ties go to 3×3 — by far the most common export.
 */
function detectGrid(width: number, height: number): [number, number] {
  let best: [number, number] = [3, 3];
  let bestScore = Infinity;
  for (const [cols, rows] of Object.values(GRID_LAYOUTS)) {
    const tileAspect = (width / cols) / (height / rows);
    const score = Math.min(Math.abs(tileAspect - 1), Math.abs(tileAspect - 0.8));
    if (score < bestScore - 0.01) { bestScore = score; best = [cols, rows]; }
  }
  return best;
}

/**
 * Slice a grid composite into tiles. Each tile is inset ~1.5% on every side
 * so the hairline gaps Instagram puts between tiles don't ride along.
 */
async function sliceGrid(buffer: Buffer, layout: string): Promise<Buffer[]> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0, height = meta.height || 0;
  if (!width || !height) throw new Error("Could not read the image dimensions.");

  const [cols, rows] = GRID_LAYOUTS[layout] || detectGrid(width, height);
  const cellW = Math.floor(width / cols), cellH = Math.floor(height / rows);
  const insetX = Math.round(cellW * 0.015), insetY = Math.round(cellH * 0.015);

  const tiles: Buffer[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(await sharp(buffer)
        .extract({
          left: c * cellW + insetX,
          top: r * cellH + insetY,
          width: cellW - insetX * 2,
          height: cellH - insetY * 2,
        })
        .jpeg({ quality: 92 })
        .toBuffer());
    }
  }
  return tiles;
}

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
  // "auto" = no shelf chosen — the extractor classifies each design itself.
  const isAuto = category === "auto";
  if (!isAuto && !(STYLE_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Pick a valid category first." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files in the upload." }, { status: 400 });

  // "" = single designs; "auto" or "3x3"-style = each file is a grid composite
  // to slice into individual tiles first. PDFs can't be sliced.
  const split = String(form.get("split") || "");
  if (split && !(split === "auto" || split in GRID_LAYOUTS)) {
    return NextResponse.json({ error: "Unknown grid layout." }, { status: 400 });
  }

  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: `That upload is ${(total / 1024 / 1024).toFixed(0)}MB — the limit is 500MB per upload. Split it into smaller drops.` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const catLabel = isAuto ? "Auto-sort inbox" : category.charAt(0).toUpperCase() + category.slice(1);
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
      const base = safe.replace(/\.[^.]+$/, "");

      // A grid composite becomes several presets sharing one set marker;
      // a plain design stays a single piece.
      const pieces: { buf: Buffer; name: string; mime: string }[] = [];
      if (split && !mime.includes("pdf")) {
        const tiles = await sliceGrid(buffer, split);
        tiles.forEach((t, i) => pieces.push({ buf: t, name: `${base}-tile-${i + 1}.jpg`, mime: "image/jpeg" }));
      } else {
        if (split && mime.includes("pdf")) errors.push(`${file.name}: PDFs can't be split as grids — uploaded whole instead.`);
        pieces.push({ buf: buffer, name: file.name || safe, mime });
      }

      const setId = pieces.length > 1 ? randomUUID() : null;
      for (const piece of pieces) {
        const { url, error } = await storeToDriveStrict(
          piece.buf,
          `${Date.now()}-${piece.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
          piece.mime,
          catLabel,
          undefined,
          STYLE_ROOT
        );
        if (!url) throw new Error(error || "Drive refused the file.");

        const { error: dbErr } = await admin.from("style_presets").insert({
          category: isAuto ? null : category,
          image_url: url,
          file_name: piece.name,
          mime: piece.mime,
          set_id: setId,
          status: "pending",
          created_by: user.id,
        });
        if (dbErr) throw new Error(dbErr.message);
        stored++;
      }
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
