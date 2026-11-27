/**
 * RecurPost integration — direct REST calls to social.recurpost.com (the same
 * endpoints their official MCP package wraps). Auth = emailid + pass_key in the
 * JSON body, from RECURPOST_EMAIL / RECURPOST_API_KEY env vars.
 */

const API_BASE = "https://social.recurpost.com";

export function isRecurPostConfigured(): boolean {
  return !!(process.env.RECURPOST_EMAIL && process.env.RECURPOST_API_KEY);
}

export async function rpCall<T = Record<string, unknown>>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isRecurPostConfigured()) {
    throw new Error("RecurPost is not configured — set RECURPOST_EMAIL and RECURPOST_API_KEY in .env");
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailid: process.env.RECURPOST_EMAIL,
      pass_key: process.env.RECURPOST_API_KEY,
      ...params,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RecurPost ${endpoint} failed (${res.status}): ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`RecurPost ${endpoint} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export const verifyLogin = () => rpCall("/api/user_login");
export const listSocialAccounts = () => rpCall("/api/social_account_list");

/**
 * How long a freshly staged file gets to settle before the one retry.
 *
 * A platform can fetch a video within a second or two of the staging copy
 * finishing and catch it incomplete — Facebook then answers "the URL was
 * reachable but the file could not be processed", and the identical bytes
 * sail through moments later (17 Oct: the same Silbells reel failed as a FB
 * reel at :08 and was accepted as a FB story at :12). That one answer earns
 * a pause and exactly one more try; every other failure reports as it came.
 */
const SETTLE_MS = 8000;
/**
 * The two answers that mean "fetch me again", not "this is broken":
 * a staging copy read mid-write, and Google's lh3 image host answering a
 * rapid second fetch with an HTML page (20 Oct: Facebook got the JPEG,
 * Instagram's fetch seconds later got text/html — the same URL served the
 * image perfectly on every later try).
 */
const TRANSIENT = [/could not be processed/i, /detected content type: text\/html/i];
export async function postContent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await rpCall("/api/post_content", params);
  const text = JSON.stringify(res);
  if (TRANSIENT.some((re) => re.test(text))) {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    return rpCall("/api/post_content", params);
  }
  return res;
}

/**
 * What actually happened to an account's posts.
 *
 * post_content answers 200 the moment RecurPost accepts a post — it says
 * nothing about whether Facebook or Instagram later published it. A creative
 * Meta rejects looks identical to one that went out, which is why "sent" in our
 * Library could mean "never appeared". This is the only endpoint that tells us
 * the real outcome.
 */
export const getHistory = (accountId: string) => rpCall("/api/history_data", { id: accountId });

// --- RecurPost API v2 (Nov 2026): the queue can be read, changed and emptied ---
//
// Until RecurPost's v2 a queued post could only be created — never changed or
// cancelled — so every correction, retry and duplicate ended with someone
// deleting the old copy by hand in RecurPost's Queue. v2 adds post_status (where
// a post stands on each account, with its queue item id), queue_post_update
// and queue_post_delete. They sign in differently: one user_login with the API
// key returns a Bearer token good for an hour, sent on every call after.

const V2_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
let v2Token: { token: string; expiresAt: number } | null = null;

async function v2Login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/user_login`, {
    method: "POST",
    headers: V2_HEADERS,
    body: JSON.stringify({ emailid: process.env.RECURPOST_EMAIL, api_key: process.env.RECURPOST_API_KEY }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.token) throw new Error(`RecurPost sign-in failed (${res.status}): ${body.error || "no token"}`);
  // A minute's margin, so a token is never sent in its last seconds.
  v2Token = { token: body.token, expiresAt: Date.now() + Math.max(120, Number(body.expires_in) || 3600) * 1000 - 60_000 };
  return body.token;
}

/** One v2 call. Signs in when needed, and once more if RecurPost says the token went stale. */
export async function rpV2<T = Record<string, unknown>>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isRecurPostConfigured()) throw new Error("RecurPost is not configured — set RECURPOST_EMAIL and RECURPOST_API_KEY in .env");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = v2Token && Date.now() < v2Token.expiresAt ? v2Token.token : await v2Login();
    const res = await fetch(`${API_BASE}/api/${endpoint}`, {
      method: "POST",
      headers: { ...V2_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
    const code = String(body.code || "");
    if (res.status === 401 && (code === "token_expired" || code === "token_invalid") && attempt === 0) {
      v2Token = null;
      continue;
    }
    // An error can also come back as HTTP 200 with the real status in the body.
    const bodyStatus = typeof body.status === "number" ? body.status : 200;
    if (!res.ok || (bodyStatus >= 400 && "error" in body)) {
      throw new Error(`RecurPost ${endpoint} failed (${res.ok ? bodyStatus : res.status}): ${String(body.error || text).slice(0, 300)}`);
    }
    return body as T;
  }
  throw new Error(`RecurPost ${endpoint}: could not sign in`);
}

/** Where a post stands on each account it went to — and the queue item id that changes or removes it there. */
export interface PostOnAccount { id: string; queue_item_id: string | null; name: string; network: string; status: string; post_date: string; post_link?: string }
export async function postStatus(ref: string): Promise<PostOnAccount[]> {
  const res = await rpV2<{ accounts?: PostOnAccount[] }>("post_status", { id: ref });
  return Array.isArray(res.accounts) ? res.accounts : [];
}

export interface Unqueued {
  /** Queue items RecurPost removed just now. */
  removed: number;
  /** Already published on that account — nothing a delete can undo. */
  published: number;
  /** Not in the queue any more (deleted earlier, or never there). */
  gone: number;
}

/**
 * Take a post out of RecurPost's queue so it is never published.
 *
 * `ref` is RecurPost's post id (post_data.id from the send). With `accountId`
 * only that account's copy goes — Bron sends one post per account, so this is
 * normally the only one anyway. Only items still scheduled are deleted; one
 * already published is reported, never touched.
 */
export async function unqueuePost(ref: string, accountId?: string | null): Promise<Unqueued> {
  const accounts = (await postStatus(ref)).filter((a) => !accountId || a.id === accountId);
  const live = accounts.filter((a) => a.queue_item_id && /^(scheduled|queued|pending)$/i.test(a.status));
  const published = accounts.filter((a) => /^(published|posted|sent|success)/i.test(a.status)).length;
  if (live.length > 0) {
    await rpV2("queue_post_delete", { id: live.map((a) => a.queue_item_id) });
  }
  return { removed: live.length, published, gone: accounts.length - live.length - published };
}

/**
 * Change a post still waiting in RecurPost's queue, in place: its time, its
 * text, its media. The corrected version replaces the queued one — nothing to
 * delete, nothing to send twice.
 */
export async function updateQueuedPost(
  ref: string,
  accountId: string | null | undefined,
  fields: { message?: string; schedule_date_time?: string; image_url?: string[]; video_url?: string }
): Promise<{ updated: number; published: number }> {
  const accounts = (await postStatus(ref)).filter((a) => !accountId || a.id === accountId);
  const live = accounts.filter((a) => a.queue_item_id && /^(scheduled|queued|pending)$/i.test(a.status));
  for (const a of live) {
    await rpV2("queue_post_update", { id: a.queue_item_id, ...fields });
  }
  return { updated: live.length, published: accounts.filter((a) => /^(published|posted|sent|success)/i.test(a.status)).length };
}
