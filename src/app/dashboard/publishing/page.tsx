"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  UploadCloud,
  CheckCircle,
  AlertCircle,
  Loader2,
  Calendar,
  Lock,
  ExternalLink,
  Settings,
  ListOrdered,
  History,
  Info
} from "lucide-react";

export default function AdPublishingPage() {
  interface ClientItem {
    id: string;
    name: string;
  }

  interface CreativeItem {
    id: string;
    type: "video" | "image" | "carousel";
    caption: string;
    media_url: string;
    qc_status: string;
    founder_approval: string;
    client_approval: string;
    published_at: string | null;
    platform_post_id: string | null;
    created_at: string;
    tasks: {
      deadline: string;
      monthly_plans: {
        clients: { id: string; name: string } | null;
      } | null;
    } | null;
  }

  interface CredentialItem {
    id: string;
    client_id: string;
    meta_page_token_encrypted: string;
    ig_business_id: string;
  }

  const [activeTab, setActiveTab] = useState<"queue" | "history" | "settings">("queue");
  
  // Clients list for settings dropdown
  const [clients, setClients] = useState<ClientItem[]>([]);
  // Creatives lists
  const [queue, setQueue] = useState<CreativeItem[]>([]);
  const [history, setHistory] = useState<CreativeItem[]>([]);
  // Credentials list mapping
  const [credentials, setCredentials] = useState<Record<string, CredentialItem>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Settings form state
  const [selectedClientId, setSelectedClientId] = useState("");
  const [metaPageToken, setMetaPageToken] = useState("");
  const [igBusinessId, setIgBusinessId] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      // 1. Fetch clients
      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, name")
        .order("name", { ascending: true });
      setClients(clientsData || []);

      // 2. Fetch all creatives with tasks & clients
      const { data: creativesData, error: creativeErr } = await supabase
        .from("creatives")
        .select(`
          *,
          tasks(
            deadline,
            monthly_plans(
              clients(id, name)
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (creativeErr) throw creativeErr;

      const allCreatives = creativesData || [];
      // Queue: client_approved = 'approved', not published yet
      setQueue(allCreatives.filter((c) => c.client_approval === "approved" && !c.published_at));
      // History: published_at is not null
      setHistory(allCreatives.filter((c) => c.published_at));

      // 3. Fetch credentials mapping
      const credsRes = await fetch("/api/clients/credentials");
      if (credsRes.ok) {
        const credsData = await credsRes.json();
        const mapping: Record<string, CredentialItem> = {};
        (credsData.credentials || []).forEach((c: CredentialItem) => {
          mapping[c.client_id] = c;
        });
        setCredentials(mapping);
      }
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to load publishing queue details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load client credentials when selected changes
  useEffect(() => {
    if (selectedClientId && credentials[selectedClientId]) {
      setIgBusinessId(credentials[selectedClientId].ig_business_id || "");
      setMetaPageToken(""); // Leave password empty for safety unless they overwrite
    } else {
      setMetaPageToken("");
      setIgBusinessId("");
    }
  }, [selectedClientId, credentials]);

  const handlePublishNow = async (creativeId: string) => {
    setActionLoading(creativeId);
    setError(null);
    try {
      const res = await fetch(`/api/creatives/${creativeId}/publish-now`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Override publish dispatch failed.");
      }

      // Success, reload all records
      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to trigger override publication.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !metaPageToken || !igBusinessId) return;

    setSettingsStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/clients/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          metaPageToken,
          igBusinessId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to encrypt credentials.");
      }

      setSettingsStatus("success");
      setMetaPageToken("");
      await fetchData();
      setTimeout(() => setSettingsStatus(null), 3000);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save client credentials.");
      setSettingsStatus(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-900 pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-1.5 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <UploadCloud className="w-4 h-4" />
            <span>Ad Publishing console</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Post & Schedule Manager</h1>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveTab("queue")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "queue"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span>Queue</span>
          </button>
          
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "history"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Published Logs</span>
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "settings"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Integrations</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Tab 1: Queue list */}
          {activeTab === "queue" && (
            <div className="space-y-4">
              <div className="bg-slate-900/10 border border-slate-900/60 p-4.5 rounded-2xl text-[10px] text-slate-400 flex items-start space-x-2.5">
                <Info className="w-4.5 h-4.5 text-indigo-400 shrink-0" />
                <p className="leading-normal">
                  Below are creatives approved by client partners, scheduled to publish at their target deadline. The system checks this list every 15 minutes via our automated cron loop. Use <strong>Publish Now</strong> to manually override the timeline.
                </p>
              </div>

              {queue.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500 text-xs">
                  No creatives currently pending in the publishing queue.
                </div>
              ) : (
                <div className="grid gap-4">
                  {queue.map((c) => (
                    <div
                      key={c.id}
                      className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                            {c.tasks?.monthly_plans?.clients?.name}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                            c.type === "video"
                              ? "bg-purple-950/40 border border-purple-900 text-purple-400"
                              : "bg-indigo-950/40 border border-indigo-900 text-indigo-400"
                          }`}>
                            {c.type}
                          </span>
                        </div>

                        <p className="text-slate-300 text-xs italic font-sans truncate max-w-xl">&ldquo;{c.caption}&rdquo;</p>

                        <div className="flex items-center space-x-4 text-[9.5px] text-slate-500 font-mono">
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-650" />
                            <span>Target Date: {c.tasks?.deadline ? new Date(c.tasks.deadline).toLocaleString() : "N/A"}</span>
                          </span>
                          
                          <a
                            href={c.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline flex items-center space-x-0.5"
                          >
                            <span>Open Media</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => handlePublishNow(c.id)}
                          disabled={!!actionLoading}
                          className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer text-[10px] flex items-center justify-center space-x-1.5 uppercase tracking-wider"
                        >
                          {actionLoading === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <UploadCloud className="w-3.5 h-3.5" />
                              <span>Publish Now</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: History Logs */}
          {activeTab === "history" && (
            <div className="space-y-4">
              {history.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500 text-xs">
                  No publication history logs found.
                </div>
              ) : (
                <div className="grid gap-4">
                  {history.map((c) => (
                    <div
                      key={c.id}
                      className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left"
                    >
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                            {c.tasks?.monthly_plans?.clients?.name}
                          </span>
                          <span className="text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 px-2 py-0.5 rounded-full font-bold flex items-center space-x-0.5">
                            <CheckCircle className="w-3 h-3" />
                            <span>Posted</span>
                          </span>
                        </div>

                        <p className="text-slate-300 text-xs italic truncate font-sans">&ldquo;{c.caption}&rdquo;</p>
                        
                        <div className="text-[9px] text-slate-500 font-mono space-y-0.5">
                          <div>Published: {c.published_at ? new Date(c.published_at).toLocaleString() : "N/A"}</div>
                          <div>Platform Post ID: {c.platform_post_id}</div>
                        </div>
                      </div>

                      <div className="flex items-center shrink-0">
                        <span className="text-[10px] text-slate-500 bg-slate-900 border border-slate-850 px-3 py-1.5 rounded-xl font-bold font-mono">
                          IG Business ID: {c.tasks?.monthly_plans?.clients?.id ? (credentials[c.tasks.monthly_plans.clients.id]?.ig_business_id || "Unset") : "Unset"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Settings Form */}
          {activeTab === "settings" && (
            <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-6 md:p-8 space-y-6">
              <div>
                <div className="flex items-center space-x-1.5 text-indigo-400 text-xs font-bold uppercase mb-1">
                  <Lock className="w-4 h-4" />
                  <span>Meta access encryption configuration</span>
                </div>
                <h3 className="text-base font-extrabold text-white">Manage Client Credentials</h3>
                <p className="text-[10.5px] text-slate-550 leading-normal font-sans mt-0.5">
                  Securely bind Meta Page Tokens and Instagram Business IDs per brand. Access keys are encrypted on save and deciphered at post-time.
                </p>
              </div>

              <form onSubmit={handleSaveCredentials} className="space-y-4 text-xs max-w-lg">
                {/* Select Client */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Client Brand</label>
                  <select
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">-- Choose Client --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {credentials[c.id] ? "✅ (Configured)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Instagram Business ID */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Instagram Business ID</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 178414000000000"
                    value={igBusinessId}
                    onChange={(e) => setIgBusinessId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none placeholder:text-slate-650"
                  />
                </div>

                {/* Meta Page Access Token */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    Meta Page Access Token
                  </label>
                  <input
                    type="password"
                    required
                    placeholder={
                      selectedClientId && credentials[selectedClientId]
                        ? "•••••••••••••••••••••••• (Encrypted, re-enter to overwrite)"
                        : "Enter Meta Page access token"
                    }
                    value={metaPageToken}
                    onChange={(e) => setMetaPageToken(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none placeholder:text-slate-650"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="submit"
                    disabled={settingsStatus === "saving"}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl cursor-pointer text-[10px] uppercase tracking-wider flex items-center space-x-1.5 shadow-lg shadow-indigo-950/20"
                  >
                    {settingsStatus === "saving" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Encrypt & Save</span>
                      </>
                    )}
                  </button>

                  {settingsStatus === "success" && (
                    <span className="text-[10px] text-emerald-400 font-bold">Credentials saved & encrypted!</span>
                  )}
                </div>
              </form>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
