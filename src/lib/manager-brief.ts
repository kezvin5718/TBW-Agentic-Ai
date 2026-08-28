import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";

/**
 * The management layer: every morning each manager walks its own territory
 * (plain database reads — no AI) and Ochrester compresses what they find into
 * one brief. Bron serves it on demand.
 *
 * Phase 2 gave them a memory. A check no longer narrates what it sees; it emits
 * a finding with a stable identity, and that finding is reconciled against a
 * ledger of what was already known. So the brief can say what is NEW, what has
 * been open for nine days, and what was fixed since yesterday — instead of
 * re-reading the same eight problems every morning as though for the first time.
 *
 * The managers do not act. They only report — the founder decides.
 */

export type ManagerKey = "brand" | "design" | "content" | "social";

/** The stored per-manager note lists. Kept as-is: the Agents Console counts them. */
export interface ManagerNotes {
  brand: string[];
  design: string[];
  content: string[];
  social: string[];
}

/** One thing a manager noticed, with an identity that survives the night. */
export interface Finding {
  manager: ManagerKey;
  /** Stable across days — `missing_contact:<client_id>` and friends. */
  key: string;
  title: string;
  /** Today's size of the problem, when it is countable. Higher is always worse. */
  metric?: number;
}

interface IssueRow {
  key: string;
  manager: string;
  title: string;
  metric: number | null;
  status: string;
  first_seen: string;
  last_seen: string;
  fixed_at: string | null;
  snooze_until: string | null;
  accepted_metric: number | null;
  times_seen: number;
}

/** What the reconciliation leaves behind for the brief to read. */
export interface Ledger {
  newToday: IssueRow[];
  stillOpen: (IssueRow & { ageDays: number })[];
  fixedToday: IssueRow[];
  acceptedCount: number;
  autoAccepted: IssueRow[];
}

interface AddressEntry { address?: string; phone?: string }

/**
 * The background jobs and how long each may reasonably go unseen — the same
 * generous thresholds /api/cron-health uses, kept here as a copy rather than
 * imported so a library never reaches into a route.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const CRON_JOBS: { key: string; label: string; schedule: string; quietAfterMs: number }[] = [
  { key: "publishing", label: "Publishing scheduler", schedule: "every 15 min", quietAfterMs: 45 * MIN },
  { key: "wa_task_bot", label: "WhatsApp task bot", schedule: "every 3 min", quietAfterMs: 20 * MIN },
  { key: "call_watcher", label: "Call recordings sweep", schedule: "every 5 min", quietAfterMs: 30 * MIN },
  { key: "ads_autopilot", label: "Ads autopilot", schedule: "06:00 daily", quietAfterMs: 26 * HOUR },
  { key: "manager_brief", label: "Manager brief", schedule: "07:45 daily", quietAfterMs: 26 * HOUR },
  { key: "morning_briefing", label: "Morning briefing", schedule: "08:00 daily", quietAfterMs: 26 * HOUR },
  { key: "overdue_digest", label: "Overdue digest", schedule: "09:00 daily", quietAfterMs: 26 * HOUR },
  { key: "storage_sweep", label: "Storage sweep", schedule: "03:30 daily", quietAfterMs: 26 * HOUR },
  { key: "weekly_learning_loop", label: "Weekly learning loop", schedule: "Sun 23:59", quietAfterMs: 8 * 24 * HOUR },
];

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Every check reads what already exists — nothing here costs an AI call. */
async function collectFindings(): Promise<Finding[]> {
  const admin = createServiceRoleClient();
  const found: Finding[] = [];

  const { data: clients } = await admin
    .from("clients")
    .select("id, name, whatsapp_group_id, deliverables_per_month")
    .is("archived_at", null);
  const clientName = new Map((clients || []).map((c) => [c.id as string, c.name as string]));

  // ── Brand Manager ─────────────────────────────────────────────────────────
  const { data: brains } = await admin.from("brand_brain").select("client_id, addresses");
  const brainByClient = new Map((brains || []).map((b) => [b.client_id as string, b]));
  for (const c of clients || []) {
    const addr = ((brainByClient.get(c.id as string)?.addresses as AddressEntry[] | null) || [])[0];
    if (!addr?.address || !addr?.phone) {
      found.push({
        manager: "brand",
        key: `missing_contact:${c.id}`,
        title: `${c.name} is missing address/phone in Brand Brain — its captions refuse until filled.`,
      });
    }
  }

  const { data: styleRows } = await admin.from("style_presets").select("category, status");
  const styleCount: Record<string, number> = { traditional: 0, modern: 0, surreal: 0, boutique: 0 };
  for (const r of styleRows || []) if (r.status === "approved" && r.category in styleCount) styleCount[r.category]++;
  if ((styleRows || []).length === 0) {
    found.push({
      manager: "brand",
      key: "style_empty",
      title: "Style Library is empty — no old designs uploaded yet, so 5b runs without your proven looks.",
    });
  } else {
    for (const [category, n] of Object.entries(styleCount)) {
      if (n >= 5) continue;
      found.push({
        manager: "brand",
        key: `style_thin:${category}`,
        // The shortfall, not the count: every metric here reads "how bad is it",
        // which is what the acceptance rule compares against.
        metric: 5 - n,
        title: `Style Library category "${category}" is still thin (${n} approved look${n === 1 ? "" : "s"}, under 5) — 5b matching stays weak there.`,
      });
    }
  }

  const { data: rejected } = await admin
    .from("creative_uploads")
    .select("client_id")
    .eq("status", "rejected")
    .gte("created_at", daysAgoIso(7));
  const rejByClient: Record<string, number> = {};
  for (const r of rejected || []) rejByClient[r.client_id as string] = (rejByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(rejByClient)) {
    if (n < 3) continue;
    found.push({
      manager: "brand",
      key: `qc_repeat:${id}`,
      metric: n,
      title: `Repeated QC rejections this week: ${clientName.get(id) || "?"} (${n}) — the brief or allowed brand names may need fixing.`,
    });
  }

  // Plan vs contract: this month's plans that promise a different count than
  // the client pays for. Production follows the plan; the gap is the founder's
  // to judge — but never silently.
  const monthStart = `${istToday().slice(0, 7)}-01`;
  const { data: monthPlans } = await admin
    .from("monthly_plans")
    .select("client_id, deliverables")
    .eq("month", monthStart)
    .not("deliverables", "is", null);
  const contractByClient = new Map((clients || []).map((c) => [c.id as string, c]));
  for (const p of monthPlans || []) {
    const planned = Number((p.deliverables as { total?: number } | null)?.total || 0);
    const client = contractByClient.get(p.client_id as string);
    const contract = Number((client as { deliverables_per_month?: number } | undefined)?.deliverables_per_month || 0);
    if (planned > 0 && contract > 0 && planned !== contract) {
      found.push({
        manager: "brand",
        key: `plan_contract_gap:${p.client_id}`,
        metric: Math.abs(planned - contract),
        title: `This month's plan for ${clientName.get(p.client_id as string) || "?"} promises a different count than the contract (plan ${planned} vs contract ${contract}).`,
      });
    }
  }

  // Unanswered client groups: newest message per group is from them and >24h old.
  const { data: waRows } = await admin
    .from("wa_inbox")
    .select("group_jid, group_name, from_me, received_at, is_dm")
    .gte("received_at", daysAgoIso(4))
    .order("received_at", { ascending: false })
    .limit(400);
  const clientByGroup = new Map(
    (clients || []).filter((c) => c.whatsapp_group_id).map((c) => [c.whatsapp_group_id as string, c.id as string])
  );
  const newestPerGroup = new Map<string, { name: string; fromMe: boolean; at: string }>();
  for (const m of waRows || []) {
    if (m.is_dm) continue;
    const jid = m.group_jid as string;
    if (!newestPerGroup.has(jid)) newestPerGroup.set(jid, { name: (m.group_name as string) || jid, fromMe: !!m.from_me, at: m.received_at as string });
  }
  for (const [jid, g] of newestPerGroup) {
    if (g.fromMe || Date.now() - new Date(g.at).getTime() <= 24 * 60 * 60 * 1000) continue;
    // Keyed by client where the group is mapped to one; an unmapped group still
    // needs an identity, so its own jid stands in.
    found.push({
      manager: "brand",
      key: `wa_unanswered:${clientByGroup.get(jid) || jid}`,
      title: `${g.name}'s last message is theirs, unanswered for over a day.`,
    });
  }

  // ── Design Manager ────────────────────────────────────────────────────────
  const { data: qcFails } = await admin
    .from("creatives")
    .select("client_id")
    .eq("qc_status", "failed")
    .gte("created_at", daysAgoIso(7));
  const qcByClient: Record<string, number> = {};
  for (const r of qcFails || []) qcByClient[r.client_id as string] = (qcByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(qcByClient)) {
    found.push({
      manager: "design",
      key: `critic_fail:${id}`,
      metric: n,
      title: `Generated creatives failing the critic this week: ${clientName.get(id) || "?"} (${n}) — check the plan's art direction or the brand's visual brief.`,
    });
  }

  // Passed the critic days ago and still waiting on a person. The work is done;
  // it is the looking at it that has stalled.
  const { data: waitingReview } = await admin
    .from("creatives")
    .select("client_id")
    .eq("qc_status", "passed")
    .eq("founder_approval", "pending")
    .lt("created_at", daysAgoIso(3));
  const reviewByClient: Record<string, number> = {};
  for (const r of waitingReview || []) reviewByClient[r.client_id as string] = (reviewByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(reviewByClient)) {
    found.push({
      manager: "design",
      key: `review_backlog:${id}`,
      metric: n,
      title: `${clientName.get(id) || "?"} has ${n} creative(s) QC-passed and waiting on your review for more than 3 days.`,
    });
  }

  // QC exists to be trusted. If it is being overruled every week, either the
  // work is fine and the rules are too tight, or it is not and somebody should
  // know — either way the founder decides, not the silence.
  const { data: overrides } = await admin
    .from("creative_uploads")
    .select("client_id")
    .not("risk_accepted_at", "is", null)
    .gte("risk_accepted_at", daysAgoIso(7));
  const overrideByClient: Record<string, number> = {};
  for (const r of overrides || []) overrideByClient[r.client_id as string] = (overrideByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(overrideByClient)) {
    found.push({
      manager: "design",
      key: `qc_overridden:${id}`,
      metric: n,
      title: `QC overruled ${n}× this week for ${clientName.get(id) || "?"} — its rules may be too strict.`,
    });
  }

  // ── Content Writing Manager ───────────────────────────────────────────────
  const { data: capStuck } = await admin
    .from("creative_uploads")
    .select("client_id, caption_status")
    .in("caption_status", ["failed", "no_contact"])
    .neq("status", "rejected");
  const capByClient: Record<string, { failed: number; noContact: number }> = {};
  for (const r of capStuck || []) {
    const c = (capByClient[r.client_id as string] ||= { failed: 0, noContact: 0 });
    if (r.caption_status === "no_contact") c.noContact++; else c.failed++;
  }
  for (const [id, c] of Object.entries(capByClient)) {
    const total = c.failed + c.noContact;
    found.push({
      manager: "content",
      key: `captions_stuck:${id}`,
      metric: total,
      title: `Captions stuck: ${clientName.get(id) || "?"} (${total}${c.noContact ? `, ${c.noContact} blocked on missing contact` : ""}). Use the Automation tab's caption backfill after fixing contacts.`,
    });
  }

  // Uploaded, approved, and then nothing. A creative nobody scheduled is work
  // already paid for and not yet used.
  const { data: trayRows } = await admin
    .from("creative_uploads")
    .select("client_id")
    .eq("status", "uploaded")
    .lt("created_at", daysAgoIso(7));
  const trayByClient: Record<string, number> = {};
  for (const r of trayRows || []) trayByClient[r.client_id as string] = (trayByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(trayByClient)) {
    found.push({
      manager: "content",
      key: `tray_stale:${id}`,
      metric: n,
      title: `${clientName.get(id) || "?"} has ${n} creative(s) sitting in the hub untouched for over a week.`,
    });
  }

  // ── Social Media Manager ──────────────────────────────────────────────────
  const { data: postFails } = await admin
    .from("social_posts")
    .select("client_id")
    .eq("status", "failed")
    .gte("created_at", daysAgoIso(7));
  const failByClient: Record<string, number> = {};
  for (const r of postFails || []) failByClient[r.client_id as string] = (failByClient[r.client_id as string] || 0) + 1;
  for (const [id, n] of Object.entries(failByClient)) {
    found.push({
      manager: "social",
      key: `publish_fail:${id}`,
      metric: n,
      title: `Posts that FAILED to publish this week: ${clientName.get(id) || "?"} (${n}).`,
    });
  }

  const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: fests }, { data: festUploads }] = await Promise.all([
    admin.from("festivals").select("id, name, scheduled_at").gte("scheduled_at", new Date().toISOString()).lte("scheduled_at", in14),
    admin.from("creative_uploads").select("festival_id").not("festival_id", "is", null),
  ]);
  const withCreative = new Set((festUploads || []).map((u) => u.festival_id as string));
  for (const f of fests || []) {
    if (withCreative.has(f.id as string)) continue;
    const when = new Date(f.scheduled_at as string).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
    found.push({
      manager: "social",
      key: `festival_bare:${f.id}`,
      title: `${f.name} (${when}) is within 14 days with NO creative attached yet.`,
    });
  }

  const [{ data: recent }, { data: upcoming }] = await Promise.all([
    admin.from("social_posts").select("client_id").gte("created_at", daysAgoIso(30)),
    admin.from("social_posts").select("client_id").in("status", ["scheduled", "queued"]).gte("scheduled_for", new Date().toISOString()),
  ]);
  const activeClients = new Set((recent || []).map((r) => r.client_id as string));
  const covered = new Set((upcoming || []).map((r) => r.client_id as string));
  for (const id of activeClients) {
    if (covered.has(id)) continue;
    found.push({
      manager: "social",
      key: `no_pipeline:${id}`,
      title: `${clientName.get(id) || "?"} posted in the last 30 days but has NOTHING scheduled ahead.`,
    });
  }

  // ── System-level, reported under the manager each one hurts most ──────────
  //
  // The balance is the brand manager's business because an empty account stops
  // captions before it stops anything else. A missing key or an unreachable
  // endpoint says nothing at all — a scan is not the place to learn that
  // OpenRouter was briefly down.
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey && !apiKey.startsWith("mock")) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const data = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
      if (res.ok && data.data) {
        const remaining = (data.data.total_credits ?? 0) - (data.data.total_usage ?? 0);
        if (remaining < 10) {
          found.push({
            manager: "brand",
            key: "credit_low",
            // Higher is worse everywhere else, so this carries the shortfall.
            metric: Math.max(0, Math.round((10 - remaining) * 100) / 100),
            title: `OpenRouter credit is down to $${remaining.toFixed(2)} — captions, plans and briefs all stop when it runs out.`,
          });
        }
      }
    } catch { /* a scan never fails because a balance check did */ }
  }

  // A background job that has gone quiet past its own threshold. Same list and
  // the same generous thresholds the health strip uses, so the two cannot
  // disagree about what "quiet" means.
  const { data: cronRows } = await admin.from("cron_runs").select("job, last_success_at");
  if (process.env.CRON_ENABLED === "true") {
    const lastByJob = new Map((cronRows || []).map((r) => [r.job as string, r.last_success_at as string | null]));
    for (const job of CRON_JOBS) {
      const last = lastByJob.get(job.key);
      const quietFor = last ? Date.now() - Date.parse(last) : null;
      if (quietFor !== null && quietFor <= job.quietAfterMs) continue;
      found.push({
        manager: "social",
        key: `cron_quiet:${job.key}`,
        title: last
          ? `${job.label} (${job.schedule}) has not run since ${new Date(last).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`
          : `${job.label} (${job.schedule}) has never run.`,
      });
    }
  }

  return found;
}

/**
 * Match this morning's findings against what was already known.
 *
 * The whole point of the ledger is that a problem keeps its identity: seen
 * again it ages, gone it is credited as fixed, silenced it stays quiet — and
 * acceptance is not a blank cheque, so a problem that doubles comes back.
 */
async function reconcile(findings: Finding[], today: string): Promise<Ledger> {
  const admin = createServiceRoleClient();
  const { data: existing } = await admin.from("manager_issues").select("*");
  const rows = (existing || []) as IssueRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const emitted = new Set(findings.map((f) => f.key));

  for (const f of findings) {
    const row = byKey.get(f.key);
    const metric = f.metric ?? null;

    if (!row) {
      await admin.from("manager_issues").insert({
        key: f.key, manager: f.manager, title: f.title, metric,
        status: "open", first_seen: today, last_seen: today, times_seen: 1,
      });
      continue;
    }

    // A scan can be re-run by hand from the Agents Console. Ageing a problem
    // because somebody pressed the button twice would make times_seen a lie.
    const seenAlreadyToday = row.last_seen === today;
    const patch: Record<string, unknown> = { title: f.title, metric, last_seen: today };
    if (!seenAlreadyToday) patch.times_seen = row.times_seen + 1;

    if (row.status === "accepted") {
      // Accepted means "I have decided to live with this much of it" — twice as
      // much is a different problem, so it comes back.
      const doubled = metric !== null && row.accepted_metric !== null && metric >= 2 * row.accepted_metric;
      if (doubled) Object.assign(patch, { status: "open", fixed_at: null, snooze_until: null, accepted_metric: null });
    } else if (row.status === "snoozed") {
      const expired = !row.snooze_until || row.snooze_until < today;
      if (expired) Object.assign(patch, { status: "open", snooze_until: null, fixed_at: null });
      // Still inside its window: refreshed, but it stays quiet.
    } else if (row.status === "fixed") {
      // It came back. Dated from today, because that is when the founder is
      // being asked about it again — an age counted from the first time it ever
      // appeared would claim it was never away.
      Object.assign(patch, { status: "open", first_seen: today, fixed_at: null });
    }

    await admin.from("manager_issues").update(patch).eq("key", f.key);
  }

  // Anything the managers no longer see has stopped happening.
  const goneKeys = rows
    .filter((r) => !emitted.has(r.key) && (r.status === "open" || r.status === "snoozed"))
    .map((r) => r.key);
  if (goneKeys.length > 0) {
    await admin.from("manager_issues").update({ status: "fixed", fixed_at: today }).in("key", goneKeys);
  }

  // The daily series behind next month's trends. Upserted, so a second scan on
  // the same day corrects the day's figure rather than failing on the key.
  const series = findings.map((f) => ({ day: today, key: f.key, metric: f.metric ?? null }));
  if (series.length > 0) {
    await admin.from("manager_metrics").upsert(series, { onConflict: "day,key" });
  }

  // Read back what the reconciliation produced, rather than reasoning about it
  // from memory: this is what the brief is written from.
  const { data: after } = await admin.from("manager_issues").select("*");
  const now = ((after || []) as IssueRow[]);

  // Open a fortnight with nothing done about it is, in practice, accepted. Said
  // once, so the founder knows the list stopped nagging on his behalf.
  const autoAccepted = now.filter(
    (r) => r.status === "open" && r.first_seen !== today && daysBetween(r.first_seen, today) >= 14
  );
  if (autoAccepted.length > 0) {
    for (const r of autoAccepted) {
      await admin.from("manager_issues")
        .update({ status: "accepted", accepted_metric: r.metric })
        .eq("key", r.key);
      r.status = "accepted";
      r.accepted_metric = r.metric;
    }
  }
  const autoAcceptedKeys = new Set(autoAccepted.map((r) => r.key));

  const open = now.filter((r) => r.status === "open" && !autoAcceptedKeys.has(r.key));
  return {
    newToday: open.filter((r) => r.first_seen === today),
    stillOpen: open
      .filter((r) => r.first_seen !== today)
      .map((r) => ({ ...r, ageDays: daysBetween(r.first_seen, today) }))
      .sort((a, b) => b.ageDays - a.ageDays),
    fixedToday: now.filter((r) => r.fixed_at === today && r.status === "fixed"),
    acceptedCount: now.filter((r) => r.status === "accepted").length,
    autoAccepted,
  };
}

/** Monday in IST — the one morning a week that gets the week-over-week read. */
function isMonday(today: string): boolean {
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
}

/**
 * Week over week, from the daily series.
 *
 * Only on Mondays: a trend read every morning is noise, and the founder's week
 * starts here. Up to three lines per manager, biggest movers first — a number
 * that went up is the point, not the whole table.
 */
async function weeklyTrends(today: string): Promise<string> {
  const admin = createServiceRoleClient();
  const dayIso = (back: number) => new Date(Date.parse(`${today}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
  const from = dayIso(14);

  const [{ data: series }, { data: issues }] = await Promise.all([
    admin.from("manager_metrics").select("day, key, metric").gte("day", from).lt("day", today),
    admin.from("manager_issues").select("key, manager, title"),
  ]);
  if (!series || series.length === 0) return "";

  const cutoff = dayIso(7);
  const sums = new Map<string, { thisWeek: number; lastWeek: number }>();
  for (const row of series) {
    const metric = Number(row.metric);
    if (!Number.isFinite(metric)) continue;
    const key = row.key as string;
    const bucket = sums.get(key) || { thisWeek: 0, lastWeek: 0 };
    if ((row.day as string) >= cutoff) bucket.thisWeek += metric;
    else bucket.lastWeek += metric;
    sums.set(key, bucket);
  }

  const meta = new Map((issues || []).map((i) => [i.key as string, i]));
  const byManager: Record<string, string[]> = {};
  const ranked = [...sums.entries()]
    .filter(([, v]) => v.thisWeek > 0 || v.lastWeek > 0)
    .sort((a, b) => b[1].thisWeek - a[1].thisWeek);
  for (const [key, v] of ranked) {
    const row = meta.get(key);
    const manager = (row?.manager as string) || "brand";
    const lines = (byManager[manager] ||= []);
    if (lines.length >= 3) continue;
    lines.push(`- ${key}: ${v.thisWeek} this week vs ${v.lastWeek} last week`);
  }

  const blocks = Object.entries(byManager).map(([manager, lines]) => `${manager}:\n${lines.join("\n")}`);
  return blocks.length > 0 ? `TRENDS (week over week):\n${blocks.join("\n")}` : "";
}

/** The per-manager lists the Agents Console counts and lists — open work only. */
function notesFromLedger(ledger: Ledger): ManagerNotes {
  const notes: ManagerNotes = { brand: [], design: [], content: [], social: [] };
  const push = (r: IssueRow, suffix = "") => {
    const key = r.manager as ManagerKey;
    if (notes[key]) notes[key].push(`${r.title}${suffix}`);
  };
  for (const r of ledger.newToday) push(r);
  for (const r of ledger.stillOpen) push(r, ` (day ${r.ageDays})`);
  return notes;
}

/** The ledger, written out for Ochrester to compress. */
function ledgerSections(ledger: Ledger, trends = ""): string {
  const line = (r: IssueRow) => `- [${r.manager}] ${r.title}`;
  const blocks: string[] = [];

  blocks.push(`NEW TODAY:\n${ledger.newToday.map(line).join("\n") || "- nothing new"}`);

  blocks.push(
    `STILL OPEN:\n${
      ledger.stillOpen.map((r) => `- [${r.manager}] day ${r.ageDays}: ${r.title}`).join("\n") || "- nothing outstanding"
    }`
  );

  blocks.push(`FIXED SINCE YESTERDAY:\n${ledger.fixedToday.map(line).join("\n") || "- nothing"}`);

  if (ledger.acceptedCount > 0) {
    blocks.push(`ACCEPTED: ${ledger.acceptedCount} accepted risk${ledger.acceptedCount === 1 ? "" : "s"} stay quiet.`);
  }
  if (ledger.autoAccepted.length > 0) {
    blocks.push(
      `AUTO-ACCEPTED TODAY (open 14 days with no action, now quiet):\n${ledger.autoAccepted.map(line).join("\n")}`
    );
  }

  if (trends) blocks.push(trends);

  return blocks.join("\n\n");
}

/** Ochrester: the ledger in, one readable brief out. Falls back to the plain sections if the model is unreachable. */
async function composeBrief(ledger: Ledger, trends = ""): Promise<string> {
  const raw = ledgerSections(ledger, trends);

  try {
    const brief = await complete({
      purpose: "manager-brief",
      model: MODEL_SMART,
      system: `You are Ochrester, the main manager of TBW Advertising's agent team. Four managers keep a ledger of what they have found; you are handed today's state of it. Compress it into ONE founder-ready brief:
1. Start with "TOP PRIORITIES TODAY:" and the 3 most urgent items (fewer if fewer exist) — one line each, client names kept, numbers kept. New problems and long-running ones both qualify.
2. Then one line per manager headed by its name, summarising the rest ("Brand: …", "Design: …", "Content: …", "Social: …"). "All clear" when a manager has nothing open.
3. Never re-describe a STILL OPEN item at full length — one clause and its age ("Suvarna's captions still stuck, day 9"). The founder has read it before.
4. Give one line of credit for anything under FIXED SINCE YESTERDAY.
5. Mention accepted risks only as the single count given, never itemised. If anything was auto-accepted today, say so once.
6. If a TRENDS block is present, close with "THIS WEEK VS LAST:" and at most 5 lines drawn from it — the biggest movers, in plain words ("Suvarna's QC rejections: 9 this week against 4 last"). Omit the section entirely when there is no TRENDS block.
Mobile-readable, no markdown headers, no invented facts — only what the ledger says.`,
      messages: [{ role: "user", content: raw }],
    });
    return brief.trim() || raw;
  } catch {
    return raw; // the sections themselves are already a usable brief
  }
}

/** Build (or rebuild) today's brief and store it. */
export async function runManagerBrief(): Promise<{ date: string; brief: string }> {
  const admin = createServiceRoleClient();
  const date = istToday();
  const findings = await collectFindings();
  const ledger = await reconcile(findings, date);
  // The week-over-week read is a Monday thing; every other morning it would be
  // noise around the things that actually need doing today.
  const trends = isMonday(date) ? await weeklyTrends(date) : "";
  const brief = await composeBrief(ledger, trends);
  const notes = notesFromLedger(ledger);
  await admin.from("manager_briefs").upsert(
    { brief_date: date, notes, brief, created_at: new Date().toISOString() },
    { onConflict: "brief_date" }
  );
  return { date, brief };
}

/** Today's brief — served from the table, built on the spot if the cron hasn't run yet. */
export async function getTodayBrief(): Promise<string> {
  const admin = createServiceRoleClient();
  const { data } = await admin.from("manager_briefs").select("brief").eq("brief_date", istToday()).maybeSingle();
  if (data?.brief) return data.brief as string;
  const { brief } = await runManagerBrief();
  return brief;
}
