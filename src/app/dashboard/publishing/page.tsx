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

  interface ScheduledPostItem {
    id: string;
    client_id: string;
    media_url: string;
    caption: string | null;
    platform: "instagram" | "facebook";
    scheduled_for: string;
    status: "scheduled" | "published" | "failed";
    attempts: number;
    last_error: string | null;
    platform_post_id: string | null;
    created_at: string;
    clients: { id: string; name: string } | null;
  }

  interface CredentialItem {
    id: string;
    client_id: string;
    meta_page_token_encrypted: string;
    ig_business_id: string;
    meta_page_id: string;
  }

  const [activeTab, setActiveTab] = useState<"queue" | "scheduled" | "history" | "settings">("queue");
  
  // Clients list for settings dropdown
  const [clients, setClients] = useState<ClientItem[]>([]);
  // Creatives lists
  const [queue, setQueue] = useState<CreativeItem[]>([]);
  const [history, setHistory] = useState<CreativeItem[]>([]);
  // Scheduled manual posts
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostItem[]>([]);
  // Credentials list mapping
  const [credentials, setCredentials] = useState<Record<string, CredentialItem>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Settings form state
  const [selectedClientId, setSelectedClientId] = useState("");
  const [metaPageToken, setMetaPageToken] = useState("");
  const [igBusinessId, setIgBusinessId] = useState("");
  const [metaPageId, setMetaPageId] = useState("");
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

      // 4. Fetch scheduled posts
      const schedRes = await fetch("/api/publishing/scheduled");
      if (schedRes.ok) {
        const schedData = await schedRes.json();
        setScheduledPosts(schedData.posts || []);
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
      setMetaPageId(credentials[selectedClientId].meta_page_id || "");
      setMetaPageToken(""); // Leave password empty for safety unless they overwrite
    } else {
      setMetaPageToken("");
      setIgBusinessId("");
      setMetaPageId("");
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
    if (!selectedClientId || !igBusinessId || !metaPageId) return;

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
          metaPageId,
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

  // Scheduling post state variables
  const [showNewPostForm, setShowNewPostForm] = useState(false);
  const [newPostClientId, setNewPostClientId] = useState("");
  const [newPostCaption, setNewPostCaption] = useState("");
  const [newPostPlatform, setNewPostPlatform] = useState<"instagram" | "facebook">("instagram");
  const [newPostScheduledFor, setNewPostScheduledFor] = useState("");
  const [newPostMediaUrl, setNewPostMediaUrl] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/publishing/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "File upload failed.");
      }

      const data = await res.json();
      setNewPostMediaUrl(data.mediaUrl);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to upload file.");
    } finally {
      setUploadingFile(false);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostClientId || !newPostMediaUrl || !newPostScheduledFor) {
      setError("Please fill out all required scheduling parameters.");
      return;
    }

    setScheduleStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/publishing/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: newPostClientId,
          mediaUrl: newPostMediaUrl,
          caption: newPostCaption,
          platform: newPostPlatform,
          scheduledFor: new Date(newPostScheduledFor).toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to schedule post.");
      }

      setScheduleStatus("success");
      setNewPostCaption("");
      setNewPostMediaUrl("");
      setNewPostScheduledFor("");
      setShowNewPostForm(false);
      await fetchData();
      setTimeout(() => setScheduleStatus(null), 3000);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to schedule post.");
      setScheduleStatus(null);
    }
  };

  const handleManualPublishNow = async (postId: string) => {
    setActionLoading(postId);
    setError(null);
    try {
      const res = await fetch(`/api/publishing/scheduled/${postId}/publish-now`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to publish post immediately.");
      }

      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to override publish scheduled post.");
    } finally {
      setActionLoading(null);
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
            onClick={() => setActiveTab("scheduled")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "scheduled"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Scheduled Posts</span>
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

          {/* Tab: Scheduled Posts */}
          {activeTab === "scheduled" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="bg-slate-900/10 border border-slate-900/60 p-4.5 rounded-2xl text-[10px] text-slate-400 flex items-start space-x-2.5 flex-1 mr-4">
                  <Info className="w-4.5 h-4.5 text-indigo-400 shrink-0" />
                  <p className="leading-normal">
                    Schedule and dispatch manual media uploads to client Facebook Pages / Instagram Business accounts. Select a client, drop in your creative asset, and define publication timelines.
                  </p>
                </div>
                
                <button
                  onClick={() => setShowNewPostForm(!showNewPostForm)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-xl cursor-pointer text-[10px] uppercase tracking-wider flex items-center space-x-1.5 shrink-0"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{showNewPostForm ? "Cancel Composer" : "New Post"}</span>
                </button>
              </div>

              {/* Compose New Scheduled Post Drawer/Form */}
              {showNewPostForm && (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-6 space-y-5 animate-in slide-in-from-top duration-300">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Compose Manual Post</h3>
                  <form onSubmit={handleScheduleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                    <div className="space-y-4">
                      {/* Brand Select */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Target Brand</label>
                        <select
                          required
                          value={newPostClientId}
                          onChange={(e) => setNewPostClientId(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none cursor-pointer"
                        >
                          <option value="">-- Choose Client --</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* File Upload Selector */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Media Attachment (Image / Video)</label>
                        <div className="flex items-center space-x-3">
                          <input
                            type="file"
                            accept="image/*,video/*"
                            onChange={handleFileUpload}
                            className="text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border file:border-slate-800 file:text-[10px] file:font-bold file:uppercase file:bg-slate-900 file:text-white hover:file:bg-slate-850 file:cursor-pointer"
                          />
                          {uploadingFile && (
                            <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                          )}
                        </div>
                        {newPostMediaUrl && (
                          <div className="pt-2 text-[10px] text-emerald-400 flex items-center space-x-1">
                            <span className="truncate max-w-[250px]">{newPostMediaUrl}</span>
                            <span>✅ Uploaded</span>
                          </div>
                        )}
                      </div>

                      {/* Platform Select */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Target Platform</label>
                        <div className="flex items-center space-x-6 text-[11px] font-semibold text-slate-350">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              name="newPostPlatform"
                              checked={newPostPlatform === "instagram"}
                              onChange={() => setNewPostPlatform("instagram")}
                              className="accent-indigo-650"
                            />
                            <span>Instagram Business</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              name="newPostPlatform"
                              checked={newPostPlatform === "facebook"}
                              onChange={() => setNewPostPlatform("facebook")}
                              className="accent-indigo-650"
                            />
                            <span>Facebook Page</span>
                          </label>
                        </div>
                      </div>

                      {/* Date/Time Picker */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Publication Schedule Date & Time</label>
                        <input
                          type="datetime-local"
                          required
                          value={newPostScheduledFor}
                          onChange={(e) => setNewPostScheduledFor(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="space-y-4 flex flex-col justify-between">
                      {/* Caption text */}
                      <div className="space-y-1 flex-1 flex flex-col">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Caption Box</label>
                        <textarea
                          placeholder="Write post copy here..."
                          value={newPostCaption}
                          onChange={(e) => setNewPostCaption(e.target.value)}
                          rows={6}
                          className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none placeholder:text-slate-650 resize-none flex-1"
                        />
                      </div>

                      {/* Preview panel */}
                      {newPostMediaUrl && (
                        <div className="border border-slate-900 rounded-2xl p-3 bg-slate-950/20 flex flex-col items-center justify-center min-h-[140px]">
                          <span className="text-[8px] font-bold text-slate-600 uppercase mb-2">Live Attachment Preview</span>
                          {newPostMediaUrl.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm)/) || newPostMediaUrl.includes("video") ? (
                            <video src={newPostMediaUrl} controls className="max-h-24 rounded-lg object-contain" />
                          ) : (
                            <img src={newPostMediaUrl} alt="Preview" className="max-h-24 rounded-lg object-contain" />
                          )}
                        </div>
                      )}

                      <div className="pt-2 flex items-center justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => setShowNewPostForm(false)}
                          className="px-4 py-2 rounded-xl border border-slate-850 text-slate-450 hover:text-white cursor-pointer font-bold uppercase tracking-wider text-[9px]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={scheduleStatus === "saving" || !newPostMediaUrl}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl cursor-pointer text-[9px] uppercase tracking-wider flex items-center space-x-1.5 shadow-lg shadow-indigo-950/20"
                        >
                          {scheduleStatus === "saving" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <Calendar className="w-3.5 h-3.5" />
                              <span>Schedule Post</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* Scheduled Posts list */}
              {scheduledPosts.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500 text-xs">
                  No manual scheduled posts found. Click <strong>New Post</strong> above to create one.
                </div>
              ) : (
                <div className="grid gap-4">
                  {scheduledPosts.map((post) => (
                    <div
                      key={post.id}
                      className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                            {post.clients?.name}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                            post.platform === "instagram"
                              ? "bg-purple-950/40 border border-purple-900 text-purple-400"
                              : "bg-indigo-950/40 border border-indigo-900 text-indigo-400"
                          }`}>
                            {post.platform}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                            post.status === "published"
                              ? "bg-emerald-950/40 border border-emerald-900 text-emerald-450"
                              : post.status === "failed"
                              ? "bg-rose-950/40 border border-rose-900 text-rose-455"
                              : "bg-slate-900 border border-slate-850 text-slate-450"
                          }`}>
                            {post.status}
                          </span>
                        </div>

                        <p className="text-slate-300 text-xs italic font-sans truncate max-w-xl">&ldquo;{post.caption}&rdquo;</p>

                        {post.last_error && (
                          <p className="text-[10px] text-rose-400 font-semibold bg-rose-950/10 border border-rose-900/20 p-2 rounded-lg leading-normal">
                            ⚠️ Failure details (Attempts: {post.attempts}): {post.last_error}
                          </p>
                        )}

                        <div className="flex items-center space-x-4 text-[9.5px] text-slate-500 font-mono">
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-650" />
                            <span>Schedule: {new Date(post.scheduled_for).toLocaleString("en-IN")}</span>
                          </span>
                          
                          <a
                            href={post.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline flex items-center space-x-0.5"
                          >
                            <span>Open Media</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      {post.status !== "published" && (
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => handleManualPublishNow(post.id)}
                            disabled={!!actionLoading}
                            className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer text-[10px] flex items-center justify-center space-x-1.5 uppercase tracking-wider"
                          >
                            {actionLoading === post.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <UploadCloud className="w-3.5 h-3.5" />
                                <span>Publish Now</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
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

                {/* Facebook Page ID */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Facebook Page ID</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 100064239845231"
                    value={metaPageId}
                    onChange={(e) => setMetaPageId(e.target.value)}
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
