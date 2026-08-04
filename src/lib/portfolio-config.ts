/**
 * Founder Zone — Portfolio Desk configuration.
 * HOLDINGS now live in the founder_holdings table (edit via the dashboard UI —
 * no redeploy needed). This file keeps only the watchlist, alert rules, and
 * news tuning. Yahoo Finance tickers: NSE = .NS suffix, BSE = .BO suffix.
 */

export interface Alert {
  ticker: string;
  type: "above" | "below";
  level: number;
  msg: string;
}

// ── Watchlist (price only, planned buys / benchmarks) ───────────────
export const WATCHLIST: Record<string, { name: string }> = {
  "HDFCBANK.NS": { name: "HDFC Bank" },
  "INFY.NS": { name: "Infosys" },
  "HCLTECH.NS": { name: "HCL Tech" },
  "M&M.NS": { name: "Mahindra & Mahindra" },
  "^NSEI": { name: "Nifty 50" },
};

// ── Alert zones ─────────────────────────────────────────────────────
// Deliberately empty: the previous levels came from the Instagram file, not
// from the founder's own written rules. Add YOUR levels here, e.g.:
// { ticker: "SUZLON.NS", type: "above", level: 60.0, msg: "TRIM ZONE — my rule" },
export const ALERTS: Alert[] = [];

// ── News tuning ─────────────────────────────────────────────────────
// Queries are auto-derived from the top holdings by invested value.
export const MAX_NEWS_QUERIES = 10;
export const MAX_HEADLINES_PER_QUERY = 3;
export const NEWS_LOOKBACK_HOURS = 24;
