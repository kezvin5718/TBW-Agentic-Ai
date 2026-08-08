import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getHistory, isRecurPostConfigured } from "@/lib/recurpost";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Asks RecurPost what actually happened to our posts.
 *
 * post_content returns 200 as soon as RecurPost accepts a post, so our Library
 * marks it "sent" long before any platform has touched it. If Facebook then
 * refuses the reel, nothing tells us — the post simply never appears, and the
 * Library still says sent. This reconciles the two.
 *
 * Nothing is rewritten silently: a post confirmed published is marked
 * "published", one RecurPost reports as failed becomes "failed" with their
 * reason attached, and anything we cannot find is left exactly as it was.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRecurPostConfigured()) {
    return NextResponse.json({ error: "RecurPost is not configured." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const platformFilter: string | null = body.platform || null;

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const map = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};

  // Only posts whose scheduled moment has passed can have an outcome yet.
  let q = admin
    .from("social_posts")
    .select("id, client_id, platform, content_type, status, recurpost_post_id, scheduled_for, created_at")
    .not("recurpost_post_id", "is", null)
    .in("status", ["sent", "failed"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (platformFilter) q = q.eq("platform", platformFilter);

  const { data: posts } = await q;
  const due = (posts || []).filter((p) => {
    const when = p.scheduled_for ? new Date(p.scheduled_for as string).getTime() : new Date(p.created_at as string).getTime();
    return when <= Date.now();
  });
  if (due.length === 0) {
    return NextResponse.json({ success: true, checked: 0, message: "Nothing has come due yet — every post here is still scheduled for the future." });
  }

  // One history call per RecurPost account rather than per post.
  const accountsNeeded = new Set<string>();
  for (const p of due) {
    const accId = Object.keys(map).find((k) => map[k]?.client_id === p.client_id && map[k]?.platform === p.platform);
    if (accId) accountsNeeded.add(accId);
  }

  const byPostId = new Map<number, { status: string; note: string }>();
  const accountErrors: string[] = [];

  for (const accId of accountsNeeded) {
    try {
      const hist = await getHistory(accId);
      const rows = extractRows(hist);
      for (const r of rows) {
        if (r.id !== null) byPostId.set(r.id, { status: r.status, note: r.note });
      }
    } catch (err: unknown) {
      accountErrors.push(`${accId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let published = 0;
  let rejected = 0;
  let unknown = 0;
  const failures: Array<{ platform: string; contentType: string; reason: string }> = [];

  for (const p of due) {
    const found = byPostId.get(Number(p.recurpost_post_id));
    if (!found) {
      unknown++;
      continue;
    }
    const isFail = /fail|error|reject|declin/i.test(found.status) || /fail|error|reject|declin/i.test(found.note);
    if (isFail) {
      rejected++;
      failures.push({ platform: p.platform as string, contentType: p.content_type as string, reason: found.note || found.status });
      await admin.from("social_posts")
        .update({ status: "failed", webhook_response: `[recurpost history] ${found.status} — ${found.note}`.slice(0, 500) })
        .eq("id", p.id);
    } else {
      published++;
      if (p.status !== "published") {
        await admin.from("social_posts").update({ status: "published" }).eq("id", p.id);
      }
    }
  }

  return NextResponse.json({
    success: true,
    checked: due.length,
    published,
    rejected,
    unknown,
    failures: failures.slice(0, 20),
    accountErrors,
    message:
      rejected > 0
        ? `${rejected} post${rejected > 1 ? "s were" : " was"} accepted by RecurPost but never published. Reasons are listed below.`
        : unknown === due.length
        ? "RecurPost's history didn't include any of these posts — they may not have run yet."
        : `${published} confirmed published, ${unknown} with no outcome recorded yet.`,
  });
}

/**
 * RecurPost's history payload shape isn't documented, so read it defensively:
 * find any array of objects that carry an id, and pull whatever status-ish and
 * message-ish fields are present rather than assuming key names.
 */
function extractRows(payload: unknown): Array<{ id: number | null; status: string; note: string }> {
  const out: Array<{ id: number | null; status: string; note: string }> = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 6 || seen.has(node)) return;
    if (typeof node === "object") seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const o = node as Record<string, unknown>;
    const rawId = o.id ?? o.post_id ?? o.postId;
    if (rawId !== undefined) {
      const n = Number(rawId);
      if (Number.isFinite(n)) {
        const status = String(o.status ?? o.post_status ?? o.state ?? "");
        const note = String(o.message ?? o.error ?? o.error_message ?? o.reason ?? o.response ?? "");
        out.push({ id: n, status, note });
      }
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };

  walk(payload, 0);
  return out;
}
