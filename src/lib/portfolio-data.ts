/**
 * Founder Zone — shared portfolio data layer.
 * Holdings come from the founder_holdings table (editable in the UI);
 * prices from Yahoo Finance chart API, news from Google News RSS (both free).
 * Consumed by /api/founder/portfolio, /api/founder/portfolio/agents, and the cron.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  WATCHLIST,
  ALERTS,
  MAX_NEWS_QUERIES,
  MAX_HEADLINES_PER_QUERY,
  NEWS_LOOKBACK_HOURS,
} from "@/lib/portfolio-config";

export interface Quote {
  price: number;
  prevClose: number;
  dayPct: number;
}

export interface Headline {
  title: string;
  publishedAt: string | null;
}

export interface HoldingRecord {
  id: string;
  account: string;
  ticker: string;
  name: string;
  avg: number;
  qty: number;
}

const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Yahoo rate-limits datacenter IPs hard: cache quotes briefly, fetch with low
// concurrency, and back off + retry on 429 instead of failing the whole board.
const QUOTE_CACHE_MS = 90_000;
const quoteCache = new Map<string, { q: Quote; at: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchQuote(ticker: string, retries = 3): Promise<Quote | null> {
  const cached = quoteCache.get(ticker);
  if (cached && Date.now() - cached.at < QUOTE_CACHE_MS) return cached.q;

  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const host = hosts[attempt % hosts.length];
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
        ticker
      )}?range=5d&interval=1d`;
      const res = await fetch(url, {
        headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 429 || res.status === 503) {
        console.warn(`[portfolio] Yahoo ${res.status} for ${ticker}, attempt ${attempt + 1}`);
        await sleep(600 * (attempt + 1) + Math.random() * 400);
        continue;
      }
      if (!res.ok) {
        console.warn(`[portfolio] Yahoo ${res.status} for ${ticker} (giving up)`);
        return null;
      }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) return null;

      const closes: number[] = (result.indicators?.quote?.[0]?.close || []).filter(
        (c: number | null): c is number => typeof c === "number"
      );
      const price = result.meta?.regularMarketPrice ?? closes[closes.length - 1];
      const prevClose =
        closes.length > 1 ? closes[closes.length - 2] : result.meta?.chartPreviousClose ?? price;
      if (typeof price !== "number" || typeof prevClose !== "number") return null;

      const q: Quote = {
        price,
        prevClose,
        dayPct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      };
      quoteCache.set(ticker, { q, at: Date.now() });
      return q;
    } catch (e) {
      console.warn(`[portfolio] quote fetch error for ${ticker}:`, e instanceof Error ? e.message : e);
      if (attempt === retries) return null;
      await sleep(400 * (attempt + 1));
    }
  }
  return null;
}

/** Fetch many tickers politely: limited concurrency + spacing (rate-limit safe). */
export async function fetchQuotes(
  tickers: string[],
  concurrency = 3
): Promise<Record<string, Quote | null>> {
  const out: Record<string, Quote | null> = {};
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tickers.length) }, async () => {
      while (idx < tickers.length) {
        const t = tickers[idx++];
        out[t] = await fetchQuote(t);
        await sleep(150);
      }
    })
  );
  return out;
}

export async function fetchNews(query: string): Promise<Headline[]> {
  try {
    const url =
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(query) +
      "&hl=en-IN&gl=IN&ceid=IN:en";
    const res = await fetch(url, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const cutoff = Date.now() - NEWS_LOOKBACK_HOURS * 3600 * 1000;
    const items: Headline[] = [];
    const itemBlocks = xml.split("<item>").slice(1);
    for (const block of itemBlocks) {
      const titleMatch =
        block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
        block.match(/<title>([\s\S]*?)<\/title>/);
      const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (!titleMatch) continue;
      const publishedAt = dateMatch ? new Date(dateMatch[1]).toISOString() : null;
      if (publishedAt && new Date(publishedAt).getTime() < cutoff) continue;
      items.push({ title: titleMatch[1].trim(), publishedAt });
      if (items.length >= MAX_HEADLINES_PER_QUERY) break;
    }
    return items;
  } catch {
    return [];
  }
}

export async function fetchHoldings(): Promise<HoldingRecord[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("founder_holdings")
    .select("id, account, ticker, name, avg, qty")
    .order("account")
    .order("name");
  if (error) throw new Error(`Holdings fetch failed: ${error.message}`);
  return (data || []).map((h) => ({ ...h, avg: Number(h.avg), qty: Number(h.qty) }));
}

export interface SnapshotHolding {
  id: string;
  account: string;
  ticker: string;
  name: string;
  unavailable?: boolean;
  price?: number;
  dayPct?: number;
  pnlPct?: number;
  value?: number;
  invested?: number;
  qty?: number;
  avg?: number;
}

export interface PortfolioSnapshot {
  asOf: string;
  portfolio: { totalValue: number; totalCost: number; totalPnlPct: number };
  accounts: { account: string; value: number; cost: number; pnlPct: number }[];
  holdings: SnapshotHolding[];
  watchlist: Array<{
    ticker: string;
    name: string;
    unavailable?: boolean;
    price?: number;
    dayPct?: number;
  }>;
  alerts: {
    rules: number;
    triggered: Array<{
      ticker: string;
      name: string;
      price: number;
      level: number;
      type: "above" | "below";
      msg: string;
    }>;
  };
  news: { query: string; headlines: Headline[] }[];
}

export async function buildSnapshot(includeNews = true): Promise<PortfolioSnapshot> {
  const holdingsRecords = await fetchHoldings();
  const tickers = Array.from(
    new Set([...holdingsRecords.map((h) => h.ticker), ...Object.keys(WATCHLIST)])
  );

  const quotes = await fetchQuotes(tickers);
  const failedCount = tickers.filter((t) => !quotes[t]).length;
  if (failedCount > 0) {
    console.warn(`[portfolio] ${failedCount}/${tickers.length} quotes unavailable this refresh`);
  }

  let totalValue = 0;
  let totalCost = 0;
  const accountTotals: Record<string, { value: number; cost: number }> = {};

  const holdings: SnapshotHolding[] = holdingsRecords.map((h) => {
    const q = quotes[h.ticker];
    const base = { id: h.id, account: h.account, ticker: h.ticker, name: h.name };
    if (!q) return { ...base, unavailable: true, qty: h.qty, avg: h.avg };
    const value = q.price * h.qty;
    const cost = h.avg * h.qty;
    totalValue += value;
    totalCost += cost;
    accountTotals[h.account] = accountTotals[h.account] || { value: 0, cost: 0 };
    accountTotals[h.account].value += value;
    accountTotals[h.account].cost += cost;
    return {
      ...base,
      price: q.price,
      dayPct: q.dayPct,
      pnlPct: h.avg ? ((q.price - h.avg) / h.avg) * 100 : 0,
      value,
      invested: cost,
      qty: h.qty,
      avg: h.avg,
    };
  });

  const accounts = Object.entries(accountTotals).map(([account, t]) => ({
    account,
    value: t.value,
    cost: t.cost,
    pnlPct: t.cost ? ((t.value - t.cost) / t.cost) * 100 : 0,
  }));

  const watchlist = Object.entries(WATCHLIST).map(([ticker, w]) => {
    const q = quotes[ticker];
    return q
      ? { ticker, name: w.name, price: q.price, dayPct: q.dayPct }
      : { ticker, name: w.name, unavailable: true };
  });

  const nameByTicker: Record<string, string> = {};
  for (const h of holdingsRecords) nameByTicker[h.ticker] = h.name;
  for (const [t, w] of Object.entries(WATCHLIST)) nameByTicker[t] = w.name;

  const triggered = ALERTS.filter((a) => {
    const q = quotes[a.ticker];
    if (!q) return false;
    return a.type === "above" ? q.price >= a.level : q.price <= a.level;
  }).map((a) => ({
    ...a,
    name: nameByTicker[a.ticker] || a.ticker,
    price: quotes[a.ticker]!.price,
  }));

  // News queries: top holdings by invested value (dedup names, skip ETFs/indices)
  let news: { query: string; headlines: Headline[] }[] = [];
  if (includeNews) {
    const byInvested = new Map<string, number>();
    for (const h of holdings) {
      if (!h.invested || h.name.toLowerCase().includes("bees")) continue;
      byInvested.set(h.name, (byInvested.get(h.name) || 0) + h.invested);
    }
    const queries = Array.from(byInvested.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NEWS_QUERIES)
      .map(([name]) => name);
    const newsResults = await Promise.all(
      queries.map(async (q) => ({ query: q, headlines: await fetchNews(q) }))
    );
    news = newsResults.filter((n) => n.headlines.length > 0);
  }

  return {
    asOf: new Date().toISOString(),
    portfolio: {
      totalValue,
      totalCost,
      totalPnlPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    },
    accounts,
    holdings,
    watchlist,
    alerts: { rules: ALERTS.length, triggered },
    news,
  };
}

/** Render a snapshot as compact plain text for LLM prompts (keeps token cost low). */
export function snapshotToText(s: PortfolioSnapshot): string {
  const lines: string[] = [];
  lines.push(`AS OF: ${s.asOf}`);
  lines.push(
    `PORTFOLIO (all accounts): value ₹${(s.portfolio.totalValue / 1e5).toFixed(2)}L, cost ₹${(
      s.portfolio.totalCost / 1e5
    ).toFixed(2)}L, overall ${s.portfolio.totalPnlPct.toFixed(1)}%`
  );
  for (const a of s.accounts) {
    lines.push(
      `  ${a.account}: ₹${(a.value / 1e5).toFixed(2)}L (${a.pnlPct >= 0 ? "+" : ""}${a.pnlPct.toFixed(1)}%)`
    );
  }
  lines.push("HOLDINGS:");
  for (const h of s.holdings) {
    lines.push(
      h.unavailable
        ? `- ${h.name} [${h.account}]: price unavailable`
        : `- ${h.name} [${h.account}] (${h.ticker}): ₹${h.price!.toFixed(2)}, day ${h.dayPct!.toFixed(
            1
          )}%, overall ${h.pnlPct!.toFixed(0)}%, weight ${(
            ((h.value || 0) / s.portfolio.totalValue) * 100
          ).toFixed(1)}%`
    );
  }
  lines.push("WATCHLIST:");
  for (const w of s.watchlist) {
    lines.push(
      w.unavailable
        ? `- ${w.name}: unavailable`
        : `- ${w.name}: ₹${w.price!.toFixed(2)} (${w.dayPct!.toFixed(1)}% day)`
    );
  }
  lines.push(
    `ALERTS TRIGGERED (${s.alerts.triggered.length}/${s.alerts.rules} rules):`
  );
  for (const a of s.alerts.triggered) {
    lines.push(`- ${a.name} @ ₹${a.price.toFixed(2)} — ${a.msg}`);
  }
  if (s.alerts.triggered.length === 0) lines.push("- none");
  if (s.news.length) {
    lines.push("NEWS (last 24h):");
    for (const n of s.news) {
      for (const h of n.headlines) lines.push(`- [${n.query}] ${h.title}`);
    }
  }
  return lines.join("\n");
}
