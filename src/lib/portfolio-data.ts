/**
 * Founder Zone — shared portfolio data layer.
 * Free data sources only (Yahoo Finance chart API + Google News RSS);
 * consumed by /api/founder/portfolio (dashboard) and /api/founder/portfolio/agents (LLM desks).
 */

import {
  HOLDINGS,
  WATCHLIST,
  ALERTS,
  NEWS_QUERIES,
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

const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchQuote(ticker: string): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?range=5d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_UA },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
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

    return {
      price,
      prevClose,
      dayPct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    };
  } catch {
    return null;
  }
}

export async function fetchNews(query: string): Promise<Headline[]> {
  try {
    const url =
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(query) +
      "&hl=en-IN&gl=IN&ceid=IN:en";
    const res = await fetch(url, { next: { revalidate: 0 } });
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

export interface PortfolioSnapshot {
  asOf: string;
  portfolio: { totalValue: number; totalCost: number; totalPnlPct: number };
  holdings: Array<{
    ticker: string;
    name: string;
    unavailable?: boolean;
    price?: number;
    dayPct?: number;
    pnlPct?: number;
    value?: number;
    qty?: number;
    avg?: number;
  }>;
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
  const tickers = Array.from(
    new Set([...Object.keys(HOLDINGS), ...Object.keys(WATCHLIST)])
  );

  const [quoteResults, newsResults] = await Promise.all([
    Promise.all(tickers.map(async (t) => [t, await fetchQuote(t)] as const)),
    includeNews
      ? Promise.all(
          NEWS_QUERIES.map(async (q) => ({ query: q, headlines: await fetchNews(q) }))
        )
      : Promise.resolve([]),
  ]);
  const quotes: Record<string, Quote | null> = Object.fromEntries(quoteResults);

  let totalValue = 0;
  let totalCost = 0;
  const holdings = Object.entries(HOLDINGS).map(([ticker, h]) => {
    const q = quotes[ticker];
    if (!q) return { ticker, name: h.name, unavailable: true };
    const value = q.price * h.qty;
    const cost = h.avg * h.qty;
    totalValue += value;
    totalCost += cost;
    return {
      ticker,
      name: h.name,
      price: q.price,
      dayPct: q.dayPct,
      pnlPct: ((q.price - h.avg) / h.avg) * 100,
      value,
      qty: h.qty,
      avg: h.avg,
    };
  });

  const watchlist = Object.entries(WATCHLIST).map(([ticker, w]) => {
    const q = quotes[ticker];
    return q
      ? { ticker, name: w.name, price: q.price, dayPct: q.dayPct }
      : { ticker, name: w.name, unavailable: true };
  });

  const triggered = ALERTS.filter((a) => {
    const q = quotes[a.ticker];
    if (!q) return false;
    return a.type === "above" ? q.price >= a.level : q.price <= a.level;
  }).map((a) => ({
    ...a,
    name: HOLDINGS[a.ticker]?.name || WATCHLIST[a.ticker]?.name || a.ticker,
    price: quotes[a.ticker]!.price,
  }));

  return {
    asOf: new Date().toISOString(),
    portfolio: {
      totalValue,
      totalCost,
      totalPnlPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    },
    holdings,
    watchlist,
    alerts: { rules: ALERTS.length, triggered },
    news: newsResults.filter((n) => n.headlines.length > 0),
  };
}

/** Render a snapshot as compact plain text for LLM prompts (keeps token cost low). */
export function snapshotToText(s: PortfolioSnapshot): string {
  const lines: string[] = [];
  lines.push(`AS OF: ${s.asOf}`);
  lines.push(
    `PORTFOLIO: value ₹${(s.portfolio.totalValue / 1e5).toFixed(2)}L, cost ₹${(
      s.portfolio.totalCost / 1e5
    ).toFixed(2)}L, overall ${s.portfolio.totalPnlPct.toFixed(1)}%`
  );
  lines.push("HOLDINGS:");
  for (const h of s.holdings) {
    lines.push(
      h.unavailable
        ? `- ${h.name}: price unavailable`
        : `- ${h.name} (${h.ticker}): ₹${h.price!.toFixed(2)}, day ${h.dayPct!.toFixed(
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
