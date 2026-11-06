import { createServiceRoleClient } from "@/lib/supabase/server";

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

export async function loadAccountMap(admin: Admin): Promise<AccountMap> {
  const { data } = await admin.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
  return (data?.value as AccountMap) || {};
}

/**
 * "instagram" when the client has one account there, "instagram (account 2 of
 * 2)" when it has several — so a result line says which copy it is about.
 */
export function accountLabel(platform: string, accounts: string[], accountId: string | undefined): string {
  if (!accountId || accounts.length < 2) return platform;
  return `${platform} (account ${accounts.indexOf(accountId) + 1} of ${accounts.length})`;
}
