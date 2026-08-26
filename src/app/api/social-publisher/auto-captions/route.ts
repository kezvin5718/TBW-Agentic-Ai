import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Each caption is a vision read plus a writing call, and they run one at a time.
export const maxDuration = 300;

/** Above this the request cannot finish inside its budget; the page sends batches. */
const MAX_PER_REQUEST = 40;

/**
 * POST — write the captions for named creatives. Body: { uploadIds: string[], force? }
 *
 * The Automation screen used to wait on a background writer that, in practice,
 * never ran: a hundred and ten creatives sat at caption_status 'none' with no
 * control on the row to do anything about it. This is that control — the same
 * engine, asked for by hand, answering per creative so an empty box can say why
 * it is empty.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const asked: unknown = body.uploadIds;
  const ids = [...new Set((Array.isArray(asked) ? asked : [])
    .filter((v): v is string => typeof v === "string" && !!v))];
  if (ids.length === 0) return NextResponse.json({ error: "No creatives given." }, { status: 400 });
  if (ids.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `Ask for at most ${MAX_PER_REQUEST} at a time.` }, { status: 400 });
  }

  const { captionForUpload } = await import("@/lib/upload-batch");
  const origin = request.nextUrl.origin;
  const cookie = request.headers.get("cookie") || "";
  const force = body.force === true;

  // One at a time: each is a paid call, and a burst of forty would put the
  // whole batch at the mercy of one rate limit.
  const results: { id: string; ok: boolean; caption?: string; error?: string }[] = [];
  for (const id of ids) {
    const out = await captionForUpload(id, origin, cookie, { force });
    results.push({ id, ...out });
  }

  const written = results.filter((r) => r.ok).length;
  return NextResponse.json({
    success: true,
    written,
    failed: results.length - written,
    results,
  });
}
