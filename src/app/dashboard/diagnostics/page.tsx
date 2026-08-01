"use client";

import { useState } from "react";
import { Activity, Loader2, Copy, Check, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type Status = "ok" | "warn" | "fail";
interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
}
interface DiagResult {
  success: boolean;
  generatedAt: string;
  summary: { ok: number; warn: number; fail: number };
  checks: Check[];
  report: string;
}

export default function DiagnosticsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to run diagnostics");
    } finally {
      setLoading(false);
    }
  };

  const copyReport = async () => {
    if (!result?.report) return;
    try {
      await navigator.clipboard.writeText(result.report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked — user can still select the <pre> manually.
      setError("Could not access clipboard — select the text box below and copy manually.");
    }
  };

  const badge = (s: Status) => {
    if (s === "ok") return { Icon: CheckCircle2, cls: "text-emerald-400 bg-emerald-950/40 border-emerald-900" };
    if (s === "warn") return { Icon: AlertTriangle, cls: "text-amber-400 bg-amber-950/40 border-amber-900" };
    return { Icon: XCircle, cls: "text-rose-400 bg-rose-950/40 border-rose-900" };
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Activity className="w-6 h-6 text-indigo-400" />
            <span>System Diagnostics</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Runs a live health check across the database, storage, AI, and Higgsfield.
            When something breaks, click <span className="text-slate-300 font-semibold">Copy Report</span> and paste it to support.
          </p>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-950/50 flex items-center space-x-2 disabled:opacity-60 cursor-pointer"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>{loading ? "Running checks..." : "Run Diagnostics"}</span>
        </button>
      </div>

      {error && (
        <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-4 text-sm text-rose-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-10 text-center text-slate-500">
          <Activity className="w-10 h-10 mx-auto text-slate-700 mb-3" />
          <p className="text-sm">Click <span className="text-slate-300 font-semibold">Run Diagnostics</span> to check every part of the system.</p>
        </div>
      )}

      {result && (
        <>
          {/* Summary + copy */}
          <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center space-x-3 text-sm font-bold">
              <span className="px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400">{result.summary.ok} OK</span>
              <span className="px-3 py-1 rounded-full bg-amber-950/40 border border-amber-900 text-amber-400">{result.summary.warn} Warnings</span>
              <span className="px-3 py-1 rounded-full bg-rose-950/40 border border-rose-900 text-rose-400">{result.summary.fail} Failed</span>
              <span className="text-[11px] text-slate-600 font-normal">{new Date(result.generatedAt).toLocaleString()}</span>
            </div>
            <button
              onClick={copyReport}
              className="px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? "Copied!" : "Copy Report"}</span>
            </button>
          </div>

          {/* Individual checks */}
          <div className="space-y-2">
            {result.checks.map((c) => {
              const { Icon, cls } = badge(c.status);
              return (
                <div key={c.id} className={`border rounded-xl p-3.5 flex items-start space-x-3 ${cls.replace("text-", "border-").split(" ")[0]} bg-slate-950/50 border-slate-900`}>
                  <div className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center ${cls}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white">{c.label}</h3>
                    <pre className="text-[11px] text-slate-400 mt-1 whitespace-pre-wrap break-words font-mono">{c.detail}</pre>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Raw report for manual copy */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Raw report (select all to copy manually)</label>
            <pre className="bg-black/50 border border-slate-900 rounded-xl p-4 text-[11px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-words font-mono max-h-96 overflow-y-auto">{result.report}</pre>
          </div>
        </>
      )}
    </div>
  );
}
