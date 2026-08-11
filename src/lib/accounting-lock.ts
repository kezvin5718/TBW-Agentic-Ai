import crypto from "crypto";

/**
 * The extra password gate on top of the founder-role check for Accounting.
 *
 * Role alone was judged not enough here — this is the founder's personal
 * ledger, not a workflow section, so it gets its own passcode and a signed,
 * short-lived cookie rather than trusting the session alone.
 */

export const ACCOUNTING_COOKIE = "tbw_acct_unlock";
const TTL_MS = 12 * 60 * 60 * 1000; // re-enter after 12 hours

const SECRET =
  process.env.ACCOUNTING_SESSION_SECRET ||
  process.env.ENCRYPTION_KEY ||
  "tbw-accounting-fallback-secret";

export function checkAccountingPassword(input: string): boolean {
  const expected = process.env.ACCOUNTING_PASSWORD || "Nuha@123";
  if (input.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(input), Buffer.from(expected));
}

export function issueAccountingToken(): { token: string; maxAge: number } {
  const expires = Date.now() + TTL_MS;
  const sig = crypto.createHmac("sha256", SECRET).update(String(expires)).digest("hex");
  return { token: `${expires}.${sig}`, maxAge: Math.floor(TTL_MS / 1000) };
}

export function verifyAccountingToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresStr, sig] = token.split(".");
  const expires = Number(expiresStr);
  if (!expires || !sig || Date.now() > expires) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(String(expires)).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
