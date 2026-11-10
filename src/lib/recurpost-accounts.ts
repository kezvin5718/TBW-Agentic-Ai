import { createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, listSocialAccounts } from "@/lib/recurpost";

/**
 * Which RecurPost accounts a client posts to, per platform.
 *
 * A client can have more than one account on a platform — Gupta Jewellers has
 * two Instagram profiles. Every send path used to take the FIRST mapped account
 * and stop looking, so the second one never got a post (Oct–Nov 2026). Every
 * path now asks this one function and sends to all of them.
 */

type Admin = ReturnType<typeof createServiceRoleClient>;
export type AccountMap = Record<string, { client_id: string; platform: string } | undefined>;

/**
 * Postgres hands jsonb keys back shorter-first, then in byte order — the order
 * the old `.find()` walked. Sorting the same way keeps the first account (the
 * one every existing post went to) first, so a single-account client sees no
 * change at all.
 */
const jsonbKeyOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export function accountsFor(map: AccountMap, clientId: string, platform: string): string[] {
  return Object.keys(map)
    .filter((k) => map[k]?.client_id === clientId && map[k]?.platform === platform)
    .sort(jsonbKeyOrder);
}

/** The ids RecurPost listed when last asked, and when that was. */
let liveCache: { at: number; ids: Set<string> } | null = null;

/**
 * The account ids RecurPost lists right now, or null when it cannot say.
 *
 * Kept for a minute so one Automation run is one question, not fifty. A mapped
 * id the kept list has never seen may have been connected seconds ago, so that
 * is a reason to ask again — though never more than once every 15 seconds,
 * because the map also holds old ids that will never be in any answer.
 */
async function liveAccountIds(mapped: string[]): Promise<Set<string> | null> {
  if (!isRecurPostConfigured()) return null;
  const age = liveCache ? Date.now() - liveCache.at : Infinity;
  if (liveCache && (age < 15_000 || (age < 60_000 && mapped.every((id) => liveCache!.ids.has(id))))) return liveCache.ids;
  try {
    const res = await listSocialAccounts();
    const raw = (Array.isArray(res) ? res : (res as Record<string, unknown>).social_accounts || (res as Record<string, unknown>).accounts || (res as Record<string, unknown>).data || []) as Array<Record<string, unknown>>;
    const ids = new Set((Array.isArray(raw) ? raw : []).map((a) => String(a.smpa_id ?? a.id ?? a.account_id ?? "")).filter(Boolean));
    // An empty list from a working account is a bad answer, not every client
    // disconnecting at once — believing it would stop every send.
    if (ids.size === 0) return liveCache?.ids ?? null;
    liveCache = { at: Date.now(), ids };
    return ids;
  } catch {
    return liveCache?.ids ?? null;
  }
}

/**
 * The saved account → client map, as the send paths should see it.
 *
 * The saved map still holds ids of accounts that were reconnected or removed
 * in RecurPost. While only the first mapped account got a post those were
 * mostly harmless; now that EVERY mapped account gets one, each dead id is a
 * failed send on every post (Swarna Kanchi's YouTube, 10 Nov 2026). So an id
 * RecurPost no longer lists is left out — unless it is the only one a client
 * has on that platform, where the failed send is the alarm that the account
 * needs reconnecting and must keep ringing.
 *
 * If RecurPost cannot be asked, the map is returned as saved.
 */
export async function loadAccountMap(admin: Admin): Promise<AccountMap> {
  const { data } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  const saved = (data?.value as AccountMap) || {};
  const live = await liveAccountIds(Object.keys(saved));
  if (!live) return saved;

  const hasLive = new Set<string>();
  for (const [id, m] of Object.entries(saved)) {
    if (m?.client_id && live.has(id)) hasLive.add(`${m.client_id}|${m.platform}`);
  }
  const out: AccountMap = {};
  for (const [id, m] of Object.entries(saved)) {
    if (!m) continue;
    if (live.has(id) || !hasLive.has(`${m.client_id}|${m.platform}`)) out[id] = m;
  }
  return out;
}

/**
 * "instagram" when the client has one account there, "instagram (account 2 of
 * 2)" when it has several — so a result line says which copy it is about.
 */
export function accountLabel(platform: string, accounts: string[], accountId: string | undefined): string {
  if (!accountId || accounts.length < 2) return platform;
  return `${platform} (account ${accounts.indexOf(accountId) + 1} of ${accounts.length})`;
}
