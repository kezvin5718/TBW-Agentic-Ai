import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { storeToDriveStrict } from "@/lib/google-drive";
import { scanJobSheet, describeScanned, type ScannedTask } from "@/lib/task-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const SHEET_ROOT = "TBW Task Sheets";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null };
  }
  return { error: null, user };
}

/**
 * POST (multipart) — read a job-sheet image into reviewable task rows.
 *
 * Nothing is created here. The sheet is filed to Drive, the rows come back for
 * a human to check and assign, and creation is a second, deliberate call.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach an image of the sheet." }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Attach a JPG, PNG or WebP image." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That image is ${(file.size / 1024 / 1024).toFixed(0)}MB — keep it under 25MB.` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safe = (file.name || "sheet.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");

  // File the original first: whatever the reader makes of it, the sheet itself
  // stays openable from every task it produces.
  const { url, error: driveErr } = await storeToDriveStrict(
    buffer, `${Date.now()}-${safe}`, file.type, undefined, undefined, SHEET_ROOT
  );

  let scan;
  try {
    scan = await scanJobSheet(`data:${file.type};base64,${buffer.toString("base64")}`);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Could not read the sheet: ${err instanceof Error ? err.message : "vision failed"}` },
      { status: 502 }
    );
  }

  if (scan.tasks.length === 0) {
    return NextResponse.json(
      { error: "Nothing readable as a job list was found in that image. A clearer, straight-on photo of the table usually fixes it." },
      { status: 422 }
    );
  }

  // Match the brand named on the sheet to a real client, so the review screen
  // opens with it already chosen instead of asking again.
  const admin = createServiceRoleClient();
  const { data: clients } = await admin.from("clients").select("id, name").is("archived_at", null);
  const hint = scan.clientHint.toLowerCase();
  const matched = hint
    ? (clients || []).find((c) => {
        const n = (c.name as string).toLowerCase();
        return hint.includes(n) || n.includes(hint.split(/\s+/)[0]);
      })
    : null;

  return NextResponse.json({
    success: true,
    sheetUrl: url,
    sheetWarning: url ? null : driveErr || "The sheet could not be filed to Drive — tasks will still be created, without the image attached.",
    clientHint: scan.clientHint,
    clientId: matched?.id || "",
    summary: scan.summary,
    tasks: scan.tasks,
    flagged: scan.tasks.filter((t) => t.issues.length > 0).length,
  });
}

/** PUT — create the reviewed rows as tasks. Body: { clientId?, sheetUrl?, tasks[] } */
export async function PUT(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;
  const user = guard.user!;

  const body = await request.json();
  const rows = Array.isArray(body.tasks) ? (body.tasks as (ScannedTask & { assigneeName?: string; deadline?: string; priority?: string })[]) : [];
  if (rows.length === 0) return NextResponse.json({ error: "No rows to create." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: members } = await admin.from("team_members").select("name, profile_id");
  const idFor = (name?: string) =>
    (members || []).find((m) => (m.name as string).toLowerCase() === (name || "").trim().toLowerCase())?.profile_id || null;

  // A week out is the house default when nobody set a date — the same fallback
  // the manual Add Task form uses, so scanned work isn't born overdue.
  const defaultDeadline = new Date(Date.now() + 7 * 86400000).toISOString();

  const payload = rows
    .filter((r) => String(r.title || "").trim())
    .map((r) => ({
      title: String(r.title).trim(),
      description: describeScanned(r) || null,
      client_id: body.clientId || null,
      type: ["print", "packaging", "design", "video", "other"].includes(String(r.type)) ? String(r.type) : "print",
      priority: ["low", "medium", "high", "urgent"].includes(String(r.priority)) ? String(r.priority) : "medium",
      status: "todo",
      deadline: r.deadline ? new Date(r.deadline).toISOString() : defaultDeadline,
      source: "sheet_scan",
      assignee_name: (r.assigneeName || "").trim() || null,
      assignee_id: idFor(r.assigneeName),
      // The sheet's own numbers stay with the task, alongside a link back to
      // the image they were read from.
      metadata: {
        created_by: user.id,
        sheet_url: body.sheetUrl || null,
        size: r.size || null,
        qty: r.qty || null,
        remark: r.remark || null,
        scan_issues: r.issues || [],
      },
    }));

  const { error } = await admin.from("tasks").insert(payload);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    created: payload.length,
    message: `${payload.length} task(s) created from the sheet.`,
  });
}
