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
