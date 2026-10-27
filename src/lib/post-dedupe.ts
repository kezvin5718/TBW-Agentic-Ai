import { createServiceRoleClient } from "@/lib/supabase/server";
import { postContent } from "@/lib/recurpost";

/**
 * One creative, one account, one slot, one post.
 *
 * RecurPost has no cancel and sends no webhooks, so a second copy that reaches
 * their queue stays there until someone deletes it by hand. Every guard we had
 * before this file looked for an earlier row AFTER the fact — two clicks, two
 * people or a blind retry that arrived within the same second all found
 * nothing and all went out. The answer is to claim the slot in the database
 * first: a unique index (social_posts_dedupe_live) holds one live row per
 * key, so whichever request writes its row first is the only one that ever
 * calls RecurPost. Everyone else is told, in words, that the post is already
 * on its way.
 *
 * A failed row sits outside the index, which is what lets a genuine retry
 * happen. Old rows carry no key and never block anything.
 */

type Admin = ReturnType<typeof createServiceRoleClient>;

/** The statuses the unique index covers — a row in one of these holds its key. */
export const LIVE_STATUSES = ["sending", "sent", "published", "uncertain"] as const;

/** What a send that never got a straight answer leaves behind, word for word. */
export const UNCERTAIN_NOTE = "RecurPost did not answer clearly — check its Queue before resending.";
export const ALREADY_OUT = "Already Published — Duplicate Prevented";
export const IN_FLIGHT = "Duplicate Detected — Posting Skipped";

/** Ten minutes: how close two "post now" sends must be to count as one. */
const NOW_WINDOW_MS = 10 * 60_000;

/**
 * Every form one file arrives in, collapsed to one name.
 *
 * The same Drive file reaches us as an lh3 image link, a drive.google.com
 * viewer link, or — for a video — the Storage mirror publishable-media made of
 * it, named after the Drive id. Comparing raw URLs saw three different posts
 * where there was one; comparing the id sees one. Anything else is its path
 * with the query dropped, so a cache-busting ?v= cannot make a copy look new.
 *
 *   https://lh3.googleusercontent.com/d/1AbC_x=w1200        → drive:1AbC_x
 *   https://drive.google.com/file/d/1AbC_x/view?usp=sharing → drive:1AbC_x
 *   …/studio-outputs/social/drive-1AbC_x.mp4                → drive:1AbC_x
 *   https://x.supabase.co/storage/v1/object/public/a/b.jpg?t=1 → /storage/v1/object/public/a/b.jpg
 */
export function mediaIdentity(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  const drive =
    raw.match(/googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/) ||
    raw.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) ||
    raw.match(/studio-outputs\/social\/drive-([A-Za-z0-9_-]+)\.[A-Za-z0-9]+/);
  if (drive) return `drive:${drive[1]}`;
  try {
    return new URL(raw).pathname;
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

export interface DedupeInput {
  clientId: string;
  accountId: string;
  platform: string;
  contentType: string;
  mediaUrl: string;
  /** The UTC instant it is scheduled for, or null for "post now". */
  scheduledIso: string | null;
}

/** "Post now" sends share a ten-minute bucket rather than an exact minute. */
const nowBucket = (ms: number) => Math.floor(ms / NOW_WINDOW_MS);

function keyPrefix(i: DedupeInput): string {
  return [i.clientId, i.accountId, i.platform, i.contentType, mediaIdentity(i.mediaUrl)].join("|");
}

/**
 * client|account|platform|type|identity|slot
 *
 * The slot is the scheduled minute in UTC ISO ("2026-10-28T08:00"), so the
 * same creative on another day or another account is a different key and goes
 * out as it always did. With no schedule the slot is the ten-minute bucket the
 * send happens in ("now:2943360"), so a double-click lands on the same key.
 */
export function dedupeKey(i: DedupeInput, atMs: number = Date.now()): string {
  const slot = i.scheduledIso ? new Date(i.scheduledIso).toISOString().slice(0, 16) : `now:${nowBucket(atMs)}`;
  return `${keyPrefix(i)}|${slot}`;
}

export interface LiveRow {
  id: string;
  status: string;
  recurpost_post_id: number | null;
  created_at: string;
}

export type Reservation =
  | { kind: "ours"; id: string; key: string }
  | { kind: "duplicate"; existing: LiveRow | null; alreadyOut: boolean; message: string }
  | { kind: "error"; message: string };

/** The words a skipped send reports, chosen by where the other copy stands. */
export function duplicateOf(existing: LiveRow | null): Extract<Reservation, { kind: "duplicate" }> {
  const alreadyOut = !!existing && (existing.status === "sent" || existing.status === "published");
  const id = existing?.recurpost_post_id ? ` (RecurPost post ${existing.recurpost_post_id})` : "";
  return { kind: "duplicate", existing, alreadyOut, message: `${alreadyOut ? ALREADY_OUT : IN_FLIGHT}${id}` };
}

async function liveHolder(admin: Admin, key: string): Promise<LiveRow | null> {
  const { data } = await admin
    .from("social_posts")
    .select("id, status, recurpost_post_id, created_at")
    .eq("dedupe_key", key)
    .in("status", LIVE_STATUSES as unknown as string[])
    .limit(1)
    .maybeSingle();
  return (data as LiveRow | null) ?? null;
}

/**
 * A "post now" sent at 10:09:58 and again at 10:10:01 falls either side of a
 * bucket line, so the index alone would let both through. Look one bucket back
 * as well, inside the ten minutes, before claiming.
 */
async function recentNowSend(admin: Admin, i: DedupeInput, excludeId?: string): Promise<LiveRow | null> {
  const b = nowBucket(Date.now());
  const prefix = keyPrefix(i);
  let q = admin
    .from("social_posts")
    .select("id, status, recurpost_post_id, created_at")
    .in("dedupe_key", [`${prefix}|now:${b}`, `${prefix}|now:${b - 1}`])
    .in("status", LIVE_STATUSES as unknown as string[])
    .gte("created_at", new Date(Date.now() - NOW_WINDOW_MS).toISOString())
    .limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.maybeSingle();
  return (data as LiveRow | null) ?? null;
}

/** When a row started sending — read back by the watchdog below. */
const sendingMark = () => `[sending since ${new Date().toISOString()}]`;

/**
 * Claim the slot: the social_posts row is written, status `sending`, BEFORE
 * RecurPost is called. A unique violation means somebody else holds it — that
 * is a clean "already on its way", never an error. RecurPost is called only
 * when this returns kind "ours".
 */
export async function reserve(admin: Admin, row: Record<string, unknown>, input: DedupeInput): Promise<Reservation> {
  if (!input.scheduledIso) {
    const recent = await recentNowSend(admin, input);
    if (recent) return duplicateOf(recent);
  }
  const key = dedupeKey(input);
  // Two goes: a holder can settle as failed between our refused insert and
  // the lookup, which frees the key — then the slot is genuinely ours to try.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin
      .from("social_posts")
      .insert({
        ...row,
        status: "sending",
        dedupe_key: key,
        social_account_id: input.accountId,
        webhook_response: sendingMark(),
      })
      .select("id")
      .single();
    if (!error && data) return { kind: "ours", id: data.id as string, key };
    if (error?.code !== "23505") {
      return { kind: "error", message: `Could not reserve the slot (${error?.message || "no row came back"}) — nothing was sent.` };
    }
    const holder = await liveHolder(admin, key);
    if (holder) return duplicateOf(holder);
  }
  return duplicateOf(null);
}

/**
 * Claim an EXISTING row for a resend — the Library's retry.
 *
 * The row is flipped to `sending` only if it is still in the status the caller
 * read, so two retries pressed together cannot both win. The same row keeps
 * its place: nothing new is inserted. A key another live row already holds is
 * refused by the index exactly as a fresh send would be.
 */
export async function reclaim(
  admin: Admin,
  id: string,
  fromStatus: string,
  input: DedupeInput | null,
  keepKey: string | null
): Promise<Reservation> {
  if (!keepKey && input && !input.scheduledIso) {
    const recent = await recentNowSend(admin, input, id);
    if (recent) return duplicateOf(recent);
  }
  const key = keepKey ?? (input ? dedupeKey(input) : null);
  const patch: Record<string, unknown> = { status: "sending", webhook_response: sendingMark() };
  if (key) patch.dedupe_key = key;
  if (input) patch.social_account_id = input.accountId;
  const { data, error } = await admin
    .from("social_posts")
    .update(patch)
    .eq("id", id)
    .eq("status", fromStatus)
    .select("id");
  if (error) {
    if (error.code === "23505" && key) return duplicateOf(await liveHolder(admin, key));
    return { kind: "error", message: `Could not reserve the slot (${error.message}) — nothing was sent.` };
  }
  // Nothing matched: another retry got there first and the row is no longer
  // in the status we read.
  if (!data || data.length === 0) {
    const { data: now } = await admin.from("social_posts").select("id, status, recurpost_post_id, created_at").eq("id", id).maybeSingle();
    return duplicateOf((now as LiveRow | null) ?? null);
  }
  return { kind: "ours", id, key: key || "" };
}

export interface SendOutcome {
  status: "sent" | "failed" | "uncertain";
  detail: string;
  rpId: number | null;
}

/**
 * RecurPost answers a successful schedule with { post_data: { id } }. That id
 * is the only handle on a queued post.
 */
export function recurPostIdOf(res: unknown): number | null {
  const id = (res as { post_data?: { id?: unknown } })?.post_data?.id;
  const n = typeof id === "string" ? Number(id) : typeof id === "number" ? id : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * One call to RecurPost, read the way every path already read it — with one
 * difference. A call that threw (a timeout, a dropped connection, a body that
 * was not JSON) used to be recorded as failed, and failed invites a retry. But
 * RecurPost may well have queued it before the answer was lost, so that retry
 * is the duplicate. It is recorded as uncertain instead, and nothing resends
 * an uncertain post without a person checking first.
 */
export async function sendToRecurPost(params: Record<string, unknown>): Promise<SendOutcome> {
  try {
    const res = await postContent(params);
    const detail = JSON.stringify(res).slice(0, 300);
    const lower = detail.toLowerCase();
    // An id back means RecurPost queued it, whatever other wording the body
    // carries. Only with no id do we read the body for errors.
    const rpId = recurPostIdOf(res);
    const ok = rpId !== null || !(lower.includes('"error"') || lower.includes('"status":"failed"') || lower.includes("invalid"));
    return { status: ok ? "sent" : "failed", detail, rpId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "uncertain", detail: `${UNCERTAIN_NOTE} (${msg.slice(0, 240)})`, rpId: null };
  }
}

/**
 * Close the reservation with what RecurPost said. `failed` drops the row out
 * of the index, freeing the key for a genuine retry; `sent` and `uncertain`
 * keep holding it.
 */
export async function settle(
  admin: Admin,
  id: string,
  outcome: SendOutcome,
  webhookResponse: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await admin
    .from("social_posts")
    .update({
      status: outcome.status,
      // Recorded whenever RecurPost gave one, even on a failure — it is the
      // handle for deleting the copy they are holding.
      ...(outcome.rpId !== null ? { recurpost_post_id: outcome.rpId } : {}),
      webhook_response: webhookResponse,
      ...extra,
    })
    .eq("id", id);
}

/**
 * The watchdog. A restart in the middle of a send leaves its row at `sending`
 * with nobody coming back for it. Ten minutes on, it is called what it is —
 * uncertain — and left for a person: RecurPost may have it, and resending
 * blind is the one thing this whole file exists to stop.
 *
 * A Library retry re-uses an old row, so created_at cannot say when sending
 * began; the "[sending since …]" mark written on the claim does.
 */
export async function expireStaleSending(): Promise<number> {
  const admin = createServiceRoleClient();
  const cutoffMs = Date.now() - NOW_WINDOW_MS;
  const { data } = await admin
    .from("social_posts")
    .select("id, created_at, webhook_response")
    .eq("status", "sending")
    .lt("created_at", new Date(cutoffMs).toISOString())
    .limit(500);
  const stale = (data || []).filter((r) => {
    const m = /\[sending since ([^\]]+)\]/.exec(String(r.webhook_response || ""));
    const since = m ? new Date(m[1]).getTime() : NaN;
    return !Number.isFinite(since) || since < cutoffMs;
  });
  let moved = 0;
  for (const r of stale) {
    // Only if it is still sending — a send that finished a moment ago keeps
    // the answer it got.
    const { data: upd } = await admin
      .from("social_posts")
      .update({ status: "uncertain", webhook_response: `[watchdog] ${UNCERTAIN_NOTE} The send was interrupted before RecurPost answered.` })
      .eq("id", r.id)
      .eq("status", "sending")
      .select("id");
    moved += upd?.length || 0;
  }
  return moved;
}

interface ScanRow {
  id: string;
  client_id: string;
  platform: string;
  content_type: string;
  media_url: string | null;
  scheduled_for: string | null;
  created_at: string;
  dedupe_key: string | null;
  duplicate_of: string | null;
  duplicate_resolution_status: string | null;
}

/** The identity a row was keyed on, if it has a key; its URL's otherwise. */
function identityOf(r: ScanRow): string {
  if (r.dedupe_key) {
    const parts = r.dedupe_key.split("|");
    // client|account|platform|type|<identity>|slot — the identity is whatever
    // sits between, so a "|" inside a path cannot shift it.
    if (parts.length >= 6) return parts.slice(4, -1).join("|");
  }
  return mediaIdentity(r.media_url);
}

/**
 * The safety net, hourly. Anything that slipped past the index — a "now" send
 * across a bucket line, an old keyless row against a new one, an account
 * remapped between two sends — is found here: live rows sharing client,
 * platform, content type, media identity and exact slot (or "now" sends within
 * ten minutes). The earliest is the original; each later one is flagged
 * duplicate_of it, manual_removal_required.
 *
 * It flags and nothing more. No row is deleted, and a row already flagged —
 * or marked resolved / not a duplicate — is never touched again.
 *
 * It reads what was created in the last 30 days plus everything still due, so
 * a post queued long ago for next week is still compared against today's.
 */
export async function scanForDuplicates(): Promise<number> {
  const admin = createServiceRoleClient();
  const COLS = "id, client_id, platform, content_type, media_url, scheduled_for, created_at, dedupe_key, duplicate_of, duplicate_resolution_status";
  const live = LIVE_STATUSES as unknown as string[];
  const createdSince = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const dueSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const rows = new Map<string, ScanRow>();
  const page = 1000;
  for (const filter of ["created", "due"] as const) {
    for (let from = 0; ; from += page) {
      let q = admin.from("social_posts").select(COLS).in("status", live);
      q = filter === "created" ? q.gte("created_at", createdSince) : q.gte("scheduled_for", dueSince);
      const { data, error } = await q.order("created_at", { ascending: true }).range(from, from + page - 1);
      if (error) throw new Error(`duplicate scan read failed: ${error.message}`);
      for (const r of (data || []) as ScanRow[]) rows.set(r.id, r);
      if (!data || data.length < page) break;
    }
  }

  const groups = new Map<string, ScanRow[]>();
  for (const r of rows.values()) {
    const slot = r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 16) : "now";
    const g = [r.client_id, r.platform, r.content_type, identityOf(r), slot].join("|");
    const list = groups.get(g) || [];
    list.push(r);
    groups.set(g, list);
  }

  const flags: Array<{ id: string; of: string }> = [];
  for (const [g, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const isNow = g.endsWith("|now");
    let anchor = list[0];
    for (const r of list.slice(1)) {
      // "Now" sends are one post only inside ten minutes of each other; the
      // same creative an hour later is a repost and stands as an original.
      if (isNow && new Date(r.created_at).getTime() - new Date(anchor.created_at).getTime() > NOW_WINDOW_MS) {
        anchor = r;
        continue;
      }
      if (r.duplicate_of || r.duplicate_resolution_status) continue;
      flags.push({ id: r.id, of: anchor.id });
    }
  }

  const now = new Date().toISOString();
  let flagged = 0;
  for (const f of flags) {
    const { data: upd } = await admin
      .from("social_posts")
      .update({ duplicate_of: f.of, duplicate_detected_at: now, duplicate_resolution_status: "manual_removal_required" })
      .eq("id", f.id)
      .is("duplicate_of", null)
      .is("duplicate_resolution_status", null)
      .select("id");
    flagged += upd?.length || 0;
  }
  return flagged;
}
