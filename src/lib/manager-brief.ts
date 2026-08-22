import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";

/**
 * Phase 1 of the management layer: every morning each manager walks its own
 * territory (plain database reads — no AI), writes its note, and Ochrester
 * compresses the four notes into one brief. Bron serves it on demand.
 *
 * The managers do not act. They only report — the founder decides.
 */

export interface ManagerNotes {
  brand: string[];
  design: string[];
  content: string[];
  social: string[];
}

interface AddressEntry { address?: string; phone?: string }

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function nameList(names: string[], cap = 8): string {
  const unique = [...new Set(names)];
  return unique.slice(0, cap).join(", ") + (unique.length > cap ? ` +${unique.length - cap} more` : "");
}

/** Every check reads what already exists — nothing here costs an AI call. */
async function collectNotes(): Promise<ManagerNotes> {
  const admin = createServiceRoleClient();
  const notes: ManagerNotes = { brand: [], design: [], content: [], social: [] };

  const { data: clients } = await admin
    .from("clients")
    .select("id, name, whatsapp_group_id, deliverables_per_month")
    .is("archived_at", null);
  const clientName = new Map((clients || []).map((c) => [c.id as string, c.name as string]));

  // ── Brand Manager ─────────────────────────────────────────────────────────
  const { data: brains } = await admin.from("brand_brain").select("client_id, addresses");
  const brainByClient = new Map((brains || []).map((b) => [b.client_id as string, b]));
  const missingContact = (clients || []).filter((c) => {
    const addr = ((brainByClient.get(c.id as string)?.addresses as AddressEntry[] | null) || [])[0];
    return !addr?.address || !addr?.phone;
  }).map((c) => c.name as string);
  if (missingContact.length > 0) {
    notes.brand.push(`${missingContact.length} client(s) missing address/phone in Brand Brain — their captions refuse until filled: ${nameList(missingContact)}.`);
  }

  const { data: styleRows } = await admin.from("style_presets").select("category, status");
  const styleCount: Record<string, number> = { traditional: 0, modern: 0, surreal: 0, boutique: 0 };
  for (const r of styleRows || []) if (r.status === "approved" && r.category in styleCount) styleCount[r.category]++;
  const thin = Object.entries(styleCount).filter(([, n]) => n < 5).map(([k, n]) => `${k} (${n})`);
  if (thin.length > 0 && (styleRows || []).length > 0) {
    notes.brand.push(`Style Library categories still thin (<5 approved looks): ${thin.join(", ")} — 5b matching stays weak there.`);
  }
  if ((styleRows || []).length === 0) {
    notes.brand.push("Style Library is empty — no old designs uploaded yet, so 5b runs without your proven looks.");
  }

  const { data: rejected } = await admin
    .from("creative_uploads")
    .select("client_id")
    .eq("status", "rejected")
    .gte("created_at", daysAgoIso(7));
  const rejByClient: Record<string, number> = {};
  for (const r of rejected || []) rejByClient[r.client_id as string] = (rejByClient[r.client_id as string] || 0) + 1;
  const repeatRej = Object.entries(rejByClient).filter(([, n]) => n >= 3);
  if (repeatRej.length > 0) {
    notes.brand.push(`Repeated QC rejections this week: ${repeatRej.map(([id, n]) => `${clientName.get(id) || "?"} (${n})`).join(", ")} — the brief or allowed brand names may need fixing.`);
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
  const gaps: string[] = [];
  for (const p of monthPlans || []) {
    const planned = Number((p.deliverables as { total?: number } | null)?.total || 0);
    const client = contractByClient.get(p.client_id as string);
    const contract = Number((client as { deliverables_per_month?: number } | undefined)?.deliverables_per_month || 0);
    if (planned > 0 && contract > 0 && planned !== contract) {
      gaps.push(`${clientName.get(p.client_id as string) || "?"} (plan ${planned} vs contract ${contract})`);
    }
  }
  if (gaps.length > 0) {
    notes.brand.push(`This month's plan promises a different count than the contract: ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? ` +${gaps.length - 8} more` : ""}.`);
  }

  // Unanswered client groups: newest message per group is from them and >24h old.
  const { data: waRows } = await admin
    .from("wa_inbox")
    .select("group_jid, group_name, from_me, received_at, is_dm")
    .gte("received_at", daysAgoIso(4))
    .order("received_at", { ascending: false })
    .limit(400);
  const newestPerGroup = new Map<string, { name: string; fromMe: boolean; at: string }>();
  for (const m of waRows || []) {
    if (m.is_dm) continue;
    const jid = m.group_jid as string;
    if (!newestPerGroup.has(jid)) newestPerGroup.set(jid, { name: (m.group_name as string) || jid, fromMe: !!m.from_me, at: m.received_at as string });
  }
  const unanswered = [...newestPerGroup.values()]
    .filter((g) => !g.fromMe && Date.now() - new Date(g.at).getTime() > 24 * 60 * 60 * 1000)
    .map((g) => g.name);
  if (unanswered.length > 0) {
    notes.brand.push(`Client groups whose last message is theirs, unanswered for over a day: ${nameList(unanswered)}.`);
  }

  // ── Design Manager ────────────────────────────────────────────────────────
  const { data: qcFails } = await admin
    .from("creatives")
    .select("client_id")
    .eq("qc_status", "failed")
    .gte("created_at", daysAgoIso(7));
  const qcByClient: Record<string, number> = {};
  for (const r of qcFails || []) qcByClient[r.client_id as string] = (qcByClient[r.client_id as string] || 0) + 1;
  const worstQc = Object.entries(qcByClient).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (worstQc.length > 0) {
    notes.design.push(`Generated creatives failing the critic this week: ${worstQc.map(([id, n]) => `${clientName.get(id) || "?"} (${n})`).join(", ")} — check the plan's art direction or the brand's visual brief.`);
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
  const capEntries = Object.entries(capByClient);
  if (capEntries.length > 0) {
    notes.content.push(`Captions stuck: ${capEntries.map(([id, c]) => `${clientName.get(id) || "?"} (${c.failed + c.noContact}${c.noContact ? `, ${c.noContact} blocked on missing contact` : ""})`).join(", ")}. Use the Automation tab's caption backfill after fixing contacts.`);
  }

  // ── Social Media Manager ──────────────────────────────────────────────────
  const { data: postFails } = await admin
    .from("social_posts")
    .select("client_id")
    .eq("status", "failed")
    .gte("created_at", daysAgoIso(7));
  const failByClient: Record<string, number> = {};
  for (const r of postFails || []) failByClient[r.client_id as string] = (failByClient[r.client_id as string] || 0) + 1;
  if (Object.keys(failByClient).length > 0) {
    notes.social.push(`Posts that FAILED to publish this week: ${Object.entries(failByClient).map(([id, n]) => `${clientName.get(id) || "?"} (${n})`).join(", ")}.`);
  }

  const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: fests }, { data: festUploads }] = await Promise.all([
    admin.from("festivals").select("id, name, scheduled_at").gte("scheduled_at", new Date().toISOString()).lte("scheduled_at", in14),
    admin.from("creative_uploads").select("festival_id").not("festival_id", "is", null),
  ]);
  const withCreative = new Set((festUploads || []).map((u) => u.festival_id as string));
  const bare = (fests || []).filter((f) => !withCreative.has(f.id as string)).map((f) => `${f.name} (${new Date(f.scheduled_at as string).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })})`);
  if (bare.length > 0) {
    notes.social.push(`Festivals in the next 14 days with NO creative attached yet: ${bare.join(", ")}.`);
  }

  const [{ data: recent }, { data: upcoming }] = await Promise.all([
    admin.from("social_posts").select("client_id").gte("created_at", daysAgoIso(30)),
    admin.from("social_posts").select("client_id").in("status", ["scheduled", "queued"]).gte("scheduled_for", new Date().toISOString()),
  ]);
  const activeClients = new Set((recent || []).map((r) => r.client_id as string));
  const covered = new Set((upcoming || []).map((r) => r.client_id as string));
  const emptyWeek = [...activeClients].filter((id) => !covered.has(id)).map((id) => clientName.get(id) || "?");
  if (emptyWeek.length > 0) {
    notes.social.push(`Clients who posted in the last 30 days but have NOTHING scheduled ahead: ${nameList(emptyWeek)}.`);
  }

  return notes;
}

/** Ochrester: four notes in, one readable brief out. Falls back to plain formatting if the model is unreachable. */
async function compress(notes: ManagerNotes): Promise<string> {
  const raw = [
    `BRAND MANAGER:\n${notes.brand.map((n) => `- ${n}`).join("\n") || "- all clear"}`,
    `DESIGN MANAGER:\n${notes.design.map((n) => `- ${n}`).join("\n") || "- all clear"}`,
    `CONTENT WRITING MANAGER:\n${notes.content.map((n) => `- ${n}`).join("\n") || "- all clear"}`,
    `SOCIAL MEDIA MANAGER:\n${notes.social.map((n) => `- ${n}`).join("\n") || "- all clear"}`,
  ].join("\n\n");

  try {
    const brief = await complete({
      purpose: "manager-brief",
      model: MODEL_SMART,
      system: `You are Ochrester, the main manager of TBW Advertising's agent team. Four managers hand you their morning notes. Compress them into ONE founder-ready brief:
1. Start with "TOP PRIORITIES TODAY:" and the 3 most urgent items (fewer if fewer exist) — one line each, client names kept, numbers kept.
2. Then one line per manager headed by its name, summarising the rest ("Brand: …", "Design: …", "Content: …", "Social: …"). "All clear" when a manager reports nothing.
Mobile-readable, no markdown headers, no invented facts — only what the notes say.`,
      messages: [{ role: "user", content: raw }],
    });
    return brief.trim() || raw;
  } catch {
    return raw; // the notes themselves are already a usable brief
  }
}

/** Build (or rebuild) today's brief and store it. */
export async function runManagerBrief(): Promise<{ date: string; brief: string }> {
  const admin = createServiceRoleClient();
  const notes = await collectNotes();
  const brief = await compress(notes);
  const date = istToday();
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
