/**
 * Founder Zone — Portfolio Desk configuration.
 * Personal to the founder account; the /api/founder/portfolio route is the only consumer.
 * Yahoo Finance tickers: NSE = .NS suffix, BSE = .BO suffix. Prices in INR.
 * Alert levels are the founder's own written rules — edit here when they change.
 */

export interface Holding {
  name: string;
  avg: number; // average buy price
  qty: number; // shares held
}

export interface Alert {
  ticker: string;
  type: "above" | "below";
  level: number;
  msg: string;
}

export const HOLDINGS: Record<string, Holding> = {
  "SUZLON.NS": { name: "Suzlon Energy", avg: 16.6, qty: 11500 },
  "BORORENEW.BO": { name: "Borosil Renewables", avg: 516.59, qty: 300 },
  "TATAPOWER.NS": { name: "Tata Power", avg: 482.82, qty: 350 },
  "CANBK.NS": { name: "Canara Bank", avg: 152.28, qty: 500 },
  "JIOFIN.NS": { name: "Jio Financial", avg: 351.24, qty: 500 },
  "INFIBEAM.NS": { name: "Infibeam/AvenuesAI", avg: 18.22, qty: 20000 },
};

export const WATCHLIST: Record<string, { name: string }> = {
  "HDFCBANK.NS": { name: "HDFC Bank" },
  "INFY.NS": { name: "Infosys" },
  "HCLTECH.NS": { name: "HCL Tech" },
  "M&M.NS": { name: "Mahindra & Mahindra" },
  "^NSEI": { name: "Nifty 50" },
};

export const ALERTS: Alert[] = [
  { ticker: "SUZLON.NS", type: "above", level: 56.0, msg: "TRIM ZONE — plan 25-30% profit booking" },
  { ticker: "INFIBEAM.NS", type: "above", level: 20.0, msg: "REDUCE ZONE — cut to half position" },
  { ticker: "HDFCBANK.NS", type: "below", level: 730.0, msg: "DEPLOY RESERVE — aggressive buy level" },
  { ticker: "M&M.NS", type: "below", level: 3300.0, msg: "BUY ZONE entered (3100-3300)" },
  { ticker: "M&M.NS", type: "below", level: 3000.0, msg: "AGGRESSIVE BUY level" },
  { ticker: "^NSEI", type: "below", level: 23535.0, msg: "Nifty -5% from reference close — accelerate tranches" },
];

export const NEWS_QUERIES = [
  "Suzlon Energy",
  "Borosil Renewables",
  "Tata Power",
  "Canara Bank",
  "Jio Financial",
  "Infibeam Avenues",
  "HDFC Bank",
  "Infosys",
  "HCL Technologies",
  "Mahindra Mahindra stock",
];

export const MAX_HEADLINES_PER_QUERY = 3;
export const NEWS_LOOKBACK_HOURS = 24;
