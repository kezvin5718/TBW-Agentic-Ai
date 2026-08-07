"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * A fetch that survives an expired session.
 *
 * Middleware is what normally refreshes the Supabase auth cookie, and /api is
 * deliberately excluded from middleware (running it there imposes Next's 10MB
 * body limit and broke large uploads). So an API call made after the access
 * token has quietly expired comes back 401 even though the person is signed in
 * — which is what happens if you sit on a page a while and then upload.
 *
 * Here we refresh the session once and try again, and if the session is really
 * gone we say so plainly instead of a bare "Unauthorized".
 *
 * Deliberately NOT applied globally: blindly retrying every POST would risk
 * sending a client's post twice.
 */
export async function fetchWithAuthRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  const supabase = createClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    throw new Error("Your session has expired. Please sign in again, then retry.");
  }

  return fetch(input, init);
}
