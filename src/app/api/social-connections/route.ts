import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getHistory, isRecurPostConfigured, listSocialAccounts } from "@/lib/recurpost";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The true state of every client × platform RecurPost mapping.
 *
 * RecurPost's green "connected" badge has been wrong twice — Swarna Kanchi's
 * YouTube showed connected while every send came back 401. So this board
 * never takes the badge's word. It reads three things instead: whether the
 * mapped id still exists in RecurPost's account list at all, what our own
 * sends to it have been answering for the last 30 days, and — only when
 * someone presses Refresh — what the account says when we ask it for its
 * history.
 */

const MAP_KEY = "recurpost_account_map";
const PLATFORMS = ["instagram", "facebook", "pinterest", "youtube"] as const;
type Platform = (typeof PLATFORMS)[number];
type Mapping = Record<string, { client_id: string; platform: string }>;

const WINDOW_DAYS = 30;
const PROBE_CONCURRENCY = 4;
const PROBE_TIMEOUT_MS = 15000;
const SNIPPET_LEN = 80;

type CellState = "connected" | "failing" | "dead" | "unmapped";
type ProbeResult = "ok" | "failing" | "unknown";

interface Cell {
  clientId: string;
  clientName: string;
  platform: Platform;
  state: CellState;
  /** The id our send paths actually use — the first match, as they find it. */
  accountId: string | null;
  /** Every id mapped to this client × platform that RecurPost no longer lists. */
  deadAccountIds: string[];
  mappedCount: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  /** When the current run of failures began — the first failure after the last success. */
  failureSince: string | null;
  reason: string | null;
  reasonFull: string | null;
  probe: ProbeResult | null;
  probeNote: string | null;
}

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  return { user, role, ok: !!user && ["founder", "employee"].includes(role) };
}

/** The ids RecurPost lists right now. Throws when the list can't be read. */
async function liveAccountIds(): Promise<Set<string>> {
  const res = await listSocialAccounts();
  // Same shape the mapping panel reads: { status, message, social_accounts: [{ smpa_id, ... }] }
  const r = res as Record<string, unknown>;
  const raw = (Array.isArray(res) ? res : r.social_accounts || r.accounts || r.data || []) as Array<Record<string, unknown>>;
  const ids = new Set<string>();
  for (const a of Array.isArray(raw) ? raw : []) {
    const id = String(a.smpa_id ?? a.id ?? a.account_id ?? "");
    if (id) ids.add(id);
  }
  // An empty list from a working account is far likelier to be a bad answer
  // than every client disconnecting at once — and believing it would paint the
  // whole board Dead and offer to delete every mapping.
  if (ids.size === 0) throw new Error("RecurPost returned an empty account list");
  return ids;
}

/**
 * Ask one account for its history and read the answer for a dead token.
 *
 * Only a clear answer counts as failing: status 401, or an error that names
 * the token / authorisation / a needed reconnect. Anything else that isn't a
 * plain success — a throw, a timeout, a 5xx, an error we can't read — is
 * "unknown". A probe that can't tell must never be what paints a cell red.
 */
async function probeAccount(accountId: string): Promise<{ result: ProbeResult; note: string | null }> {
  let body: unknown;
  try {
    body = await Promise.race([
      getHistory(accountId),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), PROBE_TIMEOUT_MS)),
    ]);
  } catch (err: unknown) {
    return { result: "unknown", note: `Live check didn't answer (${err instanceof Error ? err.message : "error"}).` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { result: Array.isArray(body) ? "ok" : "unknown", note: null };
  }
  const o = body as Record<string, unknown>;
  const status = Number(o.status);
  const errText = textOf(o.error) || textOf(o.error_message);
  if (status === 401) {
    return { result: "failing", note: `RecurPost answered 401${errText ? ` — ${errText}` : ""}. The account's token is dead; it needs reconnecting in RecurPost.` };
  }
  if (errText && /token|expired|re-?auth|re-?connect|unauthori[sz]ed|disconnected|revoked/i.test(errText)) {
    return { result: "failing", note: `RecurPost: ${errText}` };
  }
  if (!errText && (!Number.isFinite(status) || (status >= 200 && status < 300))) {
    return { result: "ok", note: null };
  }
  return { result: "unknown", note: `Live check was inconclusive${Number.isFinite(status) ? ` (${status})` : ""}${errText ? `: ${errText}` : "."}` };
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") {
    const m = (v as Record<string, unknown>).message;
    if (typeof m === "string") return m.trim();
  }
  return "";
}

/** Run fn over items, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The human part of a stored send response.
 *
 * webhook_response reads like `[risk-override] [automation] {"status":401,"error":"…"}`
 * — the bracketed tags say which path sent it, which nobody fixing an account
 * needs. Strip them, pull the error out of the JSON when there is one (the
 * body may be cut mid-string at 300 chars, so fall back to a pattern), and
 * keep the status code: "401" is the whole diagnosis on its own.
 */
function failureText(raw: string | null | undefined): string {
  let s = String(raw || "").trim();
  while (/^\[[^\]]*\]\s*/.test(s)) s = s.replace(/^\[[^\]]*\]\s*/, "");
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const e = textOf(o.error) || textOf(o.message);
      if (e) return `${o.status !== undefined ? `${o.status} — ` : ""}${e}`;
    } catch {
      const err = s.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
      const st = s.match(/"status"\s*:\s*"?(\d{3})/)?.[1];
      if (err) return `${st ? `${st} — ` : ""}${err.replace(/\\"/g, '"')}`;
    }
  }
  return s || "Failed with no reason recorded.";
}

function trimTo(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// GET — the board. ?probe=1 adds the live history check (the Refresh button);
// without it the board renders straight from mappings and send history.
export async function GET(request: NextRequest) {
  const { ok, role } = await requireStaff();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const wantProbe = request.nextUrl.searchParams.get("probe") === "1";
  const configured = isRecurPostConfigured();
  const admin = createServiceRoleClient();

  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", MAP_KEY).maybeSingle();
  const mapping = (mapRow?.value as Mapping) || {};

  // The live list decides Dead. If it can't be read, nothing is called Dead —
  // a RecurPost hiccup must not look like every mapping went stale.
  let live: Set<string> | null = null;
  let warning: string | null = null;
  if (configured) {
    try {
      live = await liveAccountIds();
    } catch (err: unknown) {
      warning = `Couldn't read RecurPost's account list (${err instanceof Error ? err.message : "error"}) — dead mappings can't be detected right now.`;
    }
  } else {
    warning = "RecurPost is not configured on this server — showing send history only.";
  }

  // Send record, last 30 days. Paged: the window holds ~2,000 rows and a
  // single select stops at 1,000.
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();
  type PostRow = { client_id: string | null; platform: string; status: string; created_at: string; webhook_response: string | null };
  const posts: PostRow[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await admin
      .from("social_posts")
      .select("client_id, platform, status, created_at, webhook_response")
      .gte("created_at", sinceIso)
      .in("platform", PLATFORMS as unknown as string[])
      .in("status", ["sent", "published", "failed"])
      .order("created_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error || !data) break;
    posts.push(...(data as PostRow[]));
    if (data.length < 1000) break;
  }

  type Record30 = { lastSuccess: string | null; lastFailure: string | null; lastFailureRaw: string | null; failures: string[] };
  const record = new Map<string, Record30>();
  const sentClients = new Set<string>();
  for (const p of posts) {
    if (!p.client_id) continue;
    sentClients.add(p.client_id);
    const key = `${p.client_id}|${p.platform}`;
    const r = record.get(key) || { lastSuccess: null, lastFailure: null, lastFailureRaw: null, failures: [] };
    // Rows arrive newest first, so the first of each kind is the latest.
    if (p.status === "failed") {
      if (!r.lastFailure) { r.lastFailure = p.created_at; r.lastFailureRaw = p.webhook_response; }
      r.failures.push(p.created_at);
    } else if (!r.lastSuccess) {
      r.lastSuccess = p.created_at;
    }
    record.set(key, r);
  }

  // Rows: anyone with a mapping on these four platforms, or a send in the
  // window. The dormant rest would drown the signal.
  const mappedClients = new Set<string>();
  for (const v of Object.values(mapping)) {
    if (v?.client_id && (PLATFORMS as readonly string[]).includes(v.platform)) mappedClients.add(v.client_id);
  }
  const clientIds = [...new Set([...mappedClients, ...sentClients])];
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: cl } = await admin.from("clients").select("id, name").in("id", clientIds);
    for (const c of cl || []) names.set(c.id as string, (c.name as string) || "Unnamed client");
  }

  const cells: Cell[] = [];
  for (const clientId of clientIds) {
    for (const platform of PLATFORMS) {
      // Object.keys(...).find — exactly how every send path picks the account,
      // so the id judged here is the id a send would actually use.
      const ids = Object.keys(mapping).filter((k) => mapping[k]?.client_id === clientId && mapping[k]?.platform === platform);
      const active = ids[0] ?? null;
      const r = record.get(`${clientId}|${platform}`);
      const lastSuccess = r?.lastSuccess ?? null;
      const lastFailure = r?.lastFailure ?? null;
      const sendFailing = !!lastFailure && (!lastSuccess || lastFailure > lastSuccess);
      // The onset: oldest failure still newer than the last success.
      const streak = sendFailing ? r!.failures.filter((t) => !lastSuccess || t > lastSuccess) : [];
      const failureSince = sendFailing ? (streak[streak.length - 1] ?? lastFailure) : null;
      const sendReason = lastFailure ? failureText(r?.lastFailureRaw) : null;

      cells.push({
        clientId,
        clientName: names.get(clientId) || "Unknown client",
        platform,
        state: !active ? "unmapped" : "connected",
        accountId: active,
        deadAccountIds: live ? ids.filter((id) => !live!.has(id)) : [],
        mappedCount: ids.length,
        lastSuccess,
        lastFailure,
        failureSince,
        reason: sendFailing && sendReason ? sendReason : null,
        reasonFull: sendFailing && sendReason ? sendReason : null,
        probe: null,
        probeNote: null,
      });
    }
  }

  // Probe only the ids a send would use, and only ones RecurPost still lists
  // (a missing id is already Dead; asking it anything proves nothing more).
  let probed = false;
  if (wantProbe && configured) {
    const targets = cells.filter((c) => c.accountId && (!live || live.has(c.accountId)));
    const results = await pool(targets, PROBE_CONCURRENCY, (c) => probeAccount(c.accountId!));
    targets.forEach((c, i) => { c.probe = results[i].result; c.probeNote = results[i].note; });
    probed = true;
  }

  for (const c of cells) {
    if (!c.accountId) { c.state = "unmapped"; continue; }
    if (live && !live.has(c.accountId)) {
      c.state = "dead";
      c.reasonFull = `Mapped account ${c.accountId} is no longer in RecurPost's account list — it was removed, or reconnected under a new id. Every send through this mapping goes nowhere.`;
      c.reason = "Not in RecurPost's account list any more";
      continue;
    }
    if (c.probe === "failing") {
      c.state = "failing";
      c.reasonFull = c.probeNote;
      c.reason = c.probeNote ? trimTo(c.probeNote, SNIPPET_LEN) : null;
      continue;
    }
    const sendFailing = !!c.lastFailure && (!c.lastSuccess || c.lastFailure > c.lastSuccess);
    if (sendFailing) {
      c.state = "failing";
      c.reason = c.reasonFull ? trimTo(c.reasonFull, SNIPPET_LEN) : null;
      continue;
    }
    c.state = "connected";
  }

  return NextResponse.json({
    success: true,
    configured,
    cells,
    refreshedAt: new Date().toISOString(),
    probed,
    canRemove: role === "founder",
    liveListOk: !!live,
    warning,
  });
}

// DELETE — { accountId }: drop one DEAD mapping from the saved map (founder only).
// A live, healthy mapping is refused — changing those is the mapping panel's job.
export async function DELETE(request: NextRequest) {
  const { ok, role } = await requireStaff();
  if (!ok || role !== "founder") return NextResponse.json({ error: "Founder only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });
  if (!isRecurPostConfigured()) {
    return NextResponse.json({ error: "RecurPost is not configured — can't confirm the mapping is dead, so nothing was removed." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", MAP_KEY).maybeSingle();
  const mapping = { ...((mapRow?.value as Mapping) || {}) };
  if (!mapping[accountId]) return NextResponse.json({ error: "That mapping is already gone." }, { status: 404 });

  let live: Set<string>;
  try {
    live = await liveAccountIds();
  } catch (err: unknown) {
    return NextResponse.json({ error: `Couldn't read RecurPost's account list (${err instanceof Error ? err.message : "error"}) — nothing was removed.` }, { status: 502 });
  }

  // Still listed: only a clear dead-token answer lets it go. A healthy or
  // inconclusive answer keeps it — we never remove what we can't prove dead.
  if (live.has(accountId)) {
    const p = await probeAccount(accountId);
    if (p.result !== "failing") {
      return NextResponse.json({
        error: p.result === "ok"
          ? "This account is live in RecurPost and answering normally — change or remove it in the RecurPost Accounts panel, not here."
          : "This account is still in RecurPost's list and the live check couldn't prove it dead — nothing was removed.",
      }, { status: 409 });
    }
  }

  const removed = mapping[accountId];
  delete mapping[accountId];
  const { error } = await admin.from("agency_settings").upsert({ key: MAP_KEY, value: mapping }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, removed: { accountId, ...removed } });
}
