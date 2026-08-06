import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sweepAll } from "@/lib/storage-archiver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Move spent Supabase Storage files to Google Drive and free the space.
 * Founder only. Defaults to a dry run — pass { apply: true } to actually move.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || (user.user_metadata?.role as string) !== "founder") {
    return NextResponse.json({ error: "Forbidden — founders only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await sweepAll({ dryRun: !body.apply });

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return NextResponse.json({
    success: true,
    dryRun: result.dryRun,
    summary: result.dryRun
      ? `Would free ${mb(result.freedBytes)} — ${result.references.archived} reference image(s), ${result.social.archived} published post file(s).`
      : `Freed ${mb(result.freedBytes)} — ${result.references.archived} reference image(s), ${result.social.archived} published post file(s) moved to Drive.`,
    references: result.references,
    social: result.social,
  });
}
