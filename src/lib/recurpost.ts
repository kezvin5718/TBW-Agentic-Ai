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
export const postContent = (params: Record<string, unknown>) => rpCall("/api/post_content", params);
