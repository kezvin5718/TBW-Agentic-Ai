"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Settings,
  Link2,
  Unlink,
  CheckCircle2,
  AlertCircle,
  Server,
  Activity,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Bot
} from "lucide-react";

interface HiggsfieldStatus {
  connected: boolean;
  status: "connected" | "disconnected" | "error";
  connectedAs?: string;
  models?: string[];
  errorMessage?: string;
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Status state
  const [status, setStatus] = useState<HiggsfieldStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Testing & Disconnecting states
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  
  // Custom Alerts
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null);

  // Manual token input states
  const [manualToken, setManualToken] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Read URL params for OAuth callbacks
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const details = searchParams.get("details");

    if (success) {
      setAlertSuccess("Successfully authenticated and connected Higgsfield MCP!");
      // Clean query params
      router.replace("/dashboard/settings/integrations");
    }

    if (error) {
      setAlertError(`OAuth connection failed: ${error} ${details ? `(${details})` : ""}`);
      router.replace("/dashboard/settings/integrations");
    }
  }, [searchParams, router]);

  // Fetch integration status
  const fetchStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await fetch("/api/integrations/higgsfield/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus({ connected: false, status: "error", errorMessage: "Failed to load integration status" });
      }
    } catch (err: unknown) {
      console.error(err);
      setStatus({ connected: false, status: "error", errorMessage: "Failed to connect to internal API" });
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Connect Handler
  const handleConnect = () => {
    window.location.href = "/api/integrations/higgsfield/connect";
  };

  // Test connection Handler
  const handleTestConnection = async () => {
    setTesting(true);
    setAlertError(null);
    setAlertSuccess(null);

    try {
      const res = await fetch("/api/integrations/higgsfield/test", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setAlertSuccess("MCP Connection healthy! Discovered models: " + (data.models?.join(", ") || "None"));
        await fetchStatus();
      } else {
        setAlertError(data.error || "Connection test returned failure");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAlertError(`Connection test crashed: ${msg}`);
    } finally {
      setTesting(false);
    }
  };

  // Refresh models Handler
  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    setAlertError(null);
    setAlertSuccess(null);

    try {
      const res = await fetch("/api/integrations/higgsfield/discover", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setAlertSuccess("Higgsfield models refreshed successfully! Discovered: " + (data.models?.join(", ") || "None"));
        await fetchStatus();
      } else {
        setAlertError(data.error || "Model refresh returned failure");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAlertError(`Model refresh crashed: ${msg}`);
    } finally {
      setRefreshingModels(false);
    }
  };

  // Manual Token Save Handler
  const handleSaveManualToken = async () => {
    if (!manualToken.trim()) return;
    setSavingManual(true);
    setAlertError(null);
    setAlertSuccess(null);

    try {
      const res = await fetch("/api/integrations/higgsfield/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: manualToken }),
      });
      const data = await res.json();

      if (data.success) {
        setAlertSuccess("Manual Higgsfield token saved! " + (data.models?.length ? `Discovered models: ${data.models.join(", ")}` : "No models found."));
        setManualToken("");
        await fetchStatus();
      } else {
        setAlertError(data.error || "Failed to save manual token");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAlertError(`Error saving manual token: ${msg}`);
    } finally {
      setSavingManual(false);
    }
  };

  // Disconnect Handler
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect the Higgsfield integration? This will remove the access tokens.")) return;

    setDisconnecting(true);
    setAlertError(null);
    setAlertSuccess(null);

    try {
      const res = await fetch("/api/integrations/higgsfield/disconnect", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setAlertSuccess("Higgsfield integration disconnected.");
        setStatus({ connected: false, status: "disconnected" });
      } else {
        setAlertError(data.error || "Disconnect failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAlertError(`Disconnect error: ${msg}`);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        <span className="text-xs text-indigo-300 font-medium animate-pulse">Loading Integration status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 py-2">
      {/* Alert Notices */}
      {alertSuccess && (
        <div className="flex items-center space-x-2.5 p-4 bg-emerald-950/20 border border-emerald-900/40 rounded-2xl text-emerald-250 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{alertSuccess}</span>
        </div>
      )}

      {alertError && (
        <div className="flex items-center space-x-2.5 p-4 bg-red-950/20 border border-red-900/40 rounded-2xl text-red-200 text-xs">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{alertError}</span>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-slate-900 pb-5">
        <div className="flex items-center space-x-2 text-indigo-450">
          <Settings className="w-5 h-5" />
          <h1 className="text-base font-bold text-white uppercase tracking-wider">Integrations & Connectors</h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Manage system-wide secure connections to external AI models and developer Model Context Protocol (MCP) servers.
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Higgsfield Integration Card */}
        <div className="md:col-span-2 bg-slate-950/40 border border-slate-900 rounded-3xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Bot className="w-5 h-5 text-indigo-450" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Higgsfield MCP Engine</h2>
                </div>
                <p className="text-[10px] text-indigo-300 font-bold uppercase font-mono">Model Context Protocol Connector</p>
              </div>

              {/* Status Badge */}
              {status?.connected ? (
                <span className="px-2.5 py-1 rounded-md bg-emerald-950/30 border border-emerald-900 text-[9px] font-extrabold tracking-wider text-emerald-300 flex items-center space-x-1 uppercase">
                  <Activity className="w-2.5 h-2.5 animate-pulse mr-1" />
                  Connected
                </span>
              ) : status?.status === "error" ? (
                <span className="px-2.5 py-1 rounded-md bg-red-950/30 border border-red-900 text-[9px] font-extrabold tracking-wider text-red-300 flex items-center space-x-1 uppercase">
                  <AlertCircle className="w-2.5 h-2.5 mr-1" />
                  Error
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-[9px] font-extrabold tracking-wider text-slate-400 flex items-center space-x-1 uppercase font-mono">
                  Not Connected
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Higgsfield image generation provides standalone visual rendering engines for products, styling reference, and UGC-style layouts. Connecting authorizes the client tools list via OAuth 2.1.
            </p>

            {/* Connection Information */}
            {status?.connected && (
              <div className="bg-slate-900/30 border border-slate-900/60 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-bold uppercase tracking-wider">Authorized Account:</span>
                  <span className="text-slate-200 font-bold font-mono">{status.connectedAs}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-bold uppercase tracking-wider">MCP Server URL:</span>
                  <span className="text-slate-400 font-mono text-[9px]">https://mcp.higgsfield.ai/mcp</span>
                </div>
                {status.models && status.models.length > 0 && (
                  <div className="pt-2 border-t border-slate-900/60">
                    <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Discovered Models:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {status.models.map(model => (
                        <span key={model} className="px-2 py-0.5 rounded bg-indigo-950/40 border border-indigo-900/60 text-[9px] text-indigo-300 font-bold font-mono">
                          {model}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {status?.status === "error" && status.errorMessage && (
              <div className="bg-red-950/10 border border-red-950/40 rounded-2xl p-4 text-[10px] text-red-300 space-y-1 leading-normal font-medium">
                <span className="font-bold uppercase tracking-wider block text-red-400">Connection Error Details:</span>
                <p>{status.errorMessage}</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-2">
            {!status?.connected ? (
              <button
                onClick={handleConnect}
                className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold uppercase tracking-wider py-2.5 px-4 rounded-xl transition-all shadow-lg shadow-indigo-950/40 cursor-pointer"
              >
                <Link2 className="w-4 h-4" />
                <span>Connect Higgsfield</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </button>
            ) : (
              <>
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-850 text-slate-300 hover:text-white text-xs font-bold uppercase tracking-wider py-2.5 px-4 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-450" />
                  )}
                  <span>Test Connection</span>
                </button>

                <button
                  onClick={handleRefreshModels}
                  disabled={refreshingModels}
                  className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-850 text-slate-300 hover:text-white text-xs font-bold uppercase tracking-wider py-2.5 px-4 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  {refreshingModels ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  ) : (
                    <Activity className="w-4 h-4 text-indigo-400" />
                  )}
                  <span>Refresh Models</span>
                </button>

                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center space-x-1.5 bg-red-950/10 hover:bg-red-950/20 border border-red-950/30 text-red-300 hover:text-red-200 text-xs font-bold uppercase tracking-wider py-2.5 px-4 rounded-xl transition-all cursor-pointer disabled:opacity-50 ml-auto"
                >
                  {disconnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin text-red-450" />
                  ) : (
                    <Unlink className="w-4 h-4 text-red-450" />
                  )}
                  <span>Disconnect</span>
                </button>
              </>
            )}
          </div>

          {!status?.connected && (
            <div className="border-t border-slate-900 pt-4 mt-4 space-y-3">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                Or Manually Link Access Token
              </span>
              <div className="flex space-x-2">
                <input
                  type="password"
                  placeholder="Paste Higgsfield Access Token..."
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-650 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  onClick={handleSaveManualToken}
                  disabled={savingManual || !manualToken.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 text-white text-[10px] font-bold uppercase tracking-wider px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 border border-transparent disabled:border-slate-800"
                >
                  {savingManual ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Save Token"
                  )}
                </button>
              </div>
              <p className="text-[9px] text-slate-600 font-medium">
                Paste your Higgsfield Access Token directly to authenticate without using redirects.
              </p>
            </div>
          )}
        </div>

        {/* Info Sidebar Card */}
        <div className="bg-slate-950/20 border border-slate-900/60 rounded-3xl p-6 space-y-4">
          <div className="flex items-center space-x-2 text-slate-400">
            <Server className="w-4 h-4 text-indigo-400" />
            <h3 className="text-[10px] font-bold uppercase tracking-wider">MCP Architecture</h3>
          </div>
          
          <div className="space-y-3.5 text-[10px] text-slate-500 leading-relaxed font-medium">
            <p>
              Model Context Protocol (MCP) is an open standard that enables secure client-server integration between AI workspaces and remote developer resource providers.
            </p>
            <p>
              <strong>Security Protocol:</strong> Access credentials are encrypted in the agency datastore using AES-256-CBC and auto-refresh on request, ensuring zero exposure of keys in plain text.
            </p>
            <div className="p-3 bg-slate-950/40 border border-slate-900 rounded-xl space-y-1 text-slate-400 font-mono">
              <span className="text-[8px] font-extrabold uppercase text-indigo-400 block mb-0.5">Callback URL:</span>
              <span className="block truncate">https://bron.digital/api/integrations/higgsfield/callback</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
