"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle, X, Copy, Check, Trash2, Bug, ShieldCheck } from "lucide-react";

interface Issue {
  id: string;
  time: string;
  kind: "HTTP" | "APP" | "NETWORK" | "JS" | "PROMISE";
  title: string;
  detail: string;
}

const STORAGE_KEY = "tbw_issue_log";
const MAX_ISSUES = 40;

/**
 * Always-on, app-wide error monitor. Mounted once in the dashboard layout, so it
 * runs on EVERY page automatically. It passively watches:
 *   - every /api/ fetch (HTTP >= 400, network failures, and app-level
 *     { error } / { status: "failed" } bodies even on HTTP 200)
 *   - uncaught JS errors and unhandled promise rejections
 * When anything trips, a red badge appears bottom-right with a one-click
 * "Copy all" so the user can paste the full context to support.
 */
export default function GlobalErrorMonitor() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastKeyRef = useRef<string>("");

  // Load any persisted issues on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setIssues(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const addIssue = useCallback((kind: Issue["kind"], title: string, detail: string) => {
    // De-dupe identical consecutive events (polling can repeat).
    const key = `${kind}|${title}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const issue: Issue = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: new Date().toISOString(),
      kind,
      title,
      detail,
    };
    setIssues((prev) => {
      const next = [issue, ...prev].slice(0, MAX_ISSUES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setOpen(true);
  }, []);

  // ---- Patch fetch to watch every API call --------------------------------
  useEffect(() => {
    const origFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof window.fetch>) => {
      const [input, init] = args;
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

      // Only inspect our own backend calls (ignore RSC/static/analytics).
      const isApi = url.includes("/api/");

      try {
        const res = await origFetch(...args);
        if (isApi) {
          if (!res.ok) {
            let body = "";
            try {
              body = (await res.clone().text()).slice(0, 600);
            } catch {
              /* ignore */
            }
            addIssue("HTTP", `${res.status} ${method} ${shortUrl(url)}`, `HTTP ${res.status} ${res.statusText}\n${method} ${url}\n\n${body}`);
          } else {
            // HTTP 200 but app reported a failure in the JSON body.
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              try {
                const data = await res.clone().json();
                const failed =
                  data &&
                  typeof data === "object" &&
                  (data.error || data.status === "failed" || data.isError === true || data.success === false);
                if (failed) {
                  const msg = data.error || data.message || data.failureState || data.status || "reported failure";
                  addIssue("APP", `${method} ${shortUrl(url)} → ${String(msg).slice(0, 80)}`, `${method} ${url}\n\n${JSON.stringify(data, null, 2).slice(0, 800)}`);
                }
              } catch {
                /* not json-parseable, ignore */
              }
            }
          }
        }
        return res;
      } catch (err: unknown) {
        if (isApi) {
          addIssue("NETWORK", `Network fail: ${method} ${shortUrl(url)}`, `${method} ${url}\n\n${err instanceof Error ? err.message : String(err)}`);
        }
        throw err;
      }
    };

    return () => {
      window.fetch = origFetch;
    };
  }, [addIssue]);

  // ---- Catch uncaught JS errors + promise rejections ----------------------
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      addIssue("JS", e.message || "Uncaught error", `${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n\n${e.error?.stack || ""}`.slice(0, 900));
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      addIssue("PROMISE", reason instanceof Error ? reason.message : String(reason), (reason instanceof Error ? reason.stack : String(reason))?.slice(0, 900) || "");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [addIssue]);

  const buildReport = () => {
    if (issues.length === 0) return "No issues captured.";
    return (
      `TBW OS ISSUE LOG — ${new Date().toISOString()}\n` +
      `${issues.length} issue(s), newest first\n` +
      `URL: ${typeof window !== "undefined" ? window.location.pathname : ""}\n` +
      `${"=".repeat(60)}\n` +
      issues
        .map((i) => `[${i.time.slice(11, 19)}] ${i.kind}: ${i.title}\n${i.detail.replace(/^/gm, "    ")}`)
        .join(`\n${"-".repeat(60)}\n`)
    );
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(buildReport());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked */
    }
  };

  const clearAll = () => {
    setIssues([]);
    lastKeyRef.current = "";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const hasIssues = issues.length > 0;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end space-y-2">
      {/* Expanded panel */}
      {open && (
        <div className="w-[min(92vw,420px)] max-h-[70vh] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-900 bg-slate-950">
            <div className="flex items-center space-x-2">
              {hasIssues ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
              <span className="text-sm font-bold text-white">Issue Monitor</span>
              {hasIssues && <span className="text-[10px] font-black bg-rose-950 text-rose-400 border border-rose-900 px-2 py-0.5 rounded-full">{issues.length}</span>}
            </div>
            <div className="flex items-center space-x-1.5">
              {hasIssues && (
                <>
                  <button onClick={copyAll} title="Copy all issues" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={clearAll} title="Clear" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-300 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={() => setOpen(false)} title="Close" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-3 space-y-2">
            {!hasIssues && (
              <div className="text-center py-8 text-slate-500">
                <ShieldCheck className="w-8 h-8 mx-auto text-emerald-500/60 mb-2" />
                <p className="text-xs">No issues detected. Monitoring every page in the background.</p>
              </div>
            )}
            {issues.map((i) => (
              <details key={i.id} className="bg-slate-950/70 border border-slate-900 rounded-xl overflow-hidden">
                <summary className="px-3 py-2 cursor-pointer flex items-center space-x-2 list-none">
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${kindStyle(i.kind)}`}>{i.kind}</span>
                  <span className="text-[11px] text-slate-300 truncate flex-1">{i.title}</span>
                  <span className="text-[9px] text-slate-600 shrink-0">{i.time.slice(11, 19)}</span>
                </summary>
                <pre className="text-[10px] text-slate-400 px-3 pb-3 whitespace-pre-wrap break-words font-mono border-t border-slate-900 pt-2">{i.detail}</pre>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Floating badge (always visible) */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={hasIssues ? `${issues.length} issue(s) detected — click to view & copy` : "System healthy — monitoring in background"}
        className={`relative flex items-center space-x-2 px-3.5 py-2.5 rounded-full border shadow-lg font-bold text-xs cursor-pointer transition-all ${
          hasIssues
            ? "bg-rose-950/90 border-rose-800 text-rose-200 shadow-rose-950/50"
            : "bg-slate-950/90 border-slate-800 text-slate-400 hover:text-white"
        }`}
      >
        {hasIssues ? (
          <>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60 animate-ping" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-600 text-white text-[9px] font-black items-center justify-center">{issues.length > 9 ? "9+" : issues.length}</span>
            </span>
            <AlertTriangle className="w-4 h-4" />
            <span>{issues.length} issue{issues.length === 1 ? "" : "s"}</span>
          </>
        ) : (
          <>
            <Bug className="w-4 h-4 text-emerald-400" />
            <span>Monitoring</span>
          </>
        )}
      </button>
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url, "http://x");
    return u.pathname;
  } catch {
    return url.slice(0, 60);
  }
}

function kindStyle(kind: Issue["kind"]): string {
  switch (kind) {
    case "HTTP":
    case "APP":
      return "bg-rose-950 text-rose-400 border-rose-900";
    case "NETWORK":
      return "bg-amber-950 text-amber-400 border-amber-900";
    default:
      return "bg-purple-950 text-purple-400 border-purple-900";
  }
}
