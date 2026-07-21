"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  X,
  Image as ImageIcon,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Download,
  FolderPlus,
  Loader2,
  Cpu,
  Compass,
  ArrowLeft,
  ArrowRight,
  Undo,
  Plus,
  Palette,
  RefreshCw
} from "lucide-react";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

interface GenerationRecord {
  id: string;
  prompt: string;
  model: string;
  ratio: string;
  reference_image_url?: string;
  higgsfield_media_ref?: string;
  generated_image_url: string;
  cost: number;
  created_at: string;
}

interface ClientRecord {
  id: string;
  name: string;
}

interface PromptTemplateItem {
  id: string;
  name: string;
  category: string;
  prompt_text: string;
  default_model: "nano_banana" | "gpt_image" | "both";
  default_ratio: string;
}

function ImageStudioWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Task Mode detection
  const taskId = searchParams.get("taskId");
  const clientId = searchParams.get("clientId");
  const clientName = searchParams.get("clientName");
  const taskName = searchParams.get("taskName");
  const plannedDate = searchParams.get("plannedDate");
  const prefilledPrompt = searchParams.get("prompt");
  const suggestedModel = searchParams.get("suggestedModel");
  const prefilledRatio = searchParams.get("ratio");

  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null); // Undo state
  const [selectedModel, setSelectedModel] = useState("Nano Banana Pro");
  const [selectedRatio, setSelectedRatio] = useState("3:4");
  
  // SECTION 1: Style Reference (exactly 1 optional slot)
  const [styleReference, setStyleReference] = useState<{ mediaUrl: string; higgsfieldMediaRef: string; fileName: string } | null>(null);
  const [uploadingStyle, setUploadingStyle] = useState(false);
  const [styleUploadError, setStyleUploadError] = useState<string | null>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  // SECTION 2: Product Images (1 to 10 slots)
  const [productImages, setProductImages] = useState<Array<{ mediaUrl: string; higgsfieldMediaRef: string; fileName: string }>>([]);
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [productUploadError, setProductUploadError] = useState<string | null>(null);
  const productFileInputRef = useRef<HTMLInputElement>(null);

  // Generation status state
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // History & Clients lists
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Credit Tracking
  const [monthlyCredits, setMonthlyCredits] = useState(0);
  const [creditAlert, setCreditAlert] = useState(false);

  // Connection Tracking
  const [higgsfieldConnected, setHiggsfieldConnected] = useState<boolean | null>(null);

  // Templates
  const [templates, setTemplates] = useState<PromptTemplateItem[]>([]);

  // Task mode specific assets (guidelines images)
  const [guidelineImages, setGuidelineImages] = useState<string[]>([]);
  const [loadingGuidelines, setLoadingGuidelines] = useState(false);

  // "Use for this Task" or "Save to Client" modal states
  const [savingRecord, setSavingRecord] = useState<GenerationRecord | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [savingToBrain, setSavingToBrain] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  const [attachingToTask, setAttachingToTask] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncSuccessMessage, setSyncSuccessMessage] = useState<string | null>(null);

  const handleSyncFromHiggsfield = async () => {
    setSyncing(true);
    setSyncSuccessMessage(null);
    setGenerationError(null);
    try {
      const res = await fetch("/api/production/higgsfield/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }
      setSyncSuccessMessage(`Successfully synced ${data.importedCount || 0} generation(s) from Higgsfield!`);
      await fetchHistory();
      await fetchMonthlyCredits();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerationError(`Sync error: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  const supabase = createClient();

  // Load parameters from query context
  useEffect(() => {
    if (prefilledPrompt) setPrompt(prefilledPrompt);
    if (suggestedModel) setSelectedModel(suggestedModel);
    if (prefilledRatio) setSelectedRatio(prefilledRatio);
  }, [prefilledPrompt, suggestedModel, prefilledRatio]);

  // Load initial data
  useEffect(() => {
    fetchHistory();
    fetchClients();
    fetchMonthlyCredits();
    fetchTemplates();
    checkHiggsfieldConnection();
  }, []);

  // Fetch task-specific guidelines creatives
  useEffect(() => {
    if (clientId) {
      fetchClientGuidelines(clientId);
    } else {
      setGuidelineImages([]);
    }
  }, [clientId]);

  const checkHiggsfieldConnection = async () => {
    try {
      const res = await fetch("/api/integrations/higgsfield/status");
      if (res.ok) {
        const data = await res.json();
        setHiggsfieldConnected(data.connected === true);
      } else {
        setHiggsfieldConnected(false);
      }
    } catch {
      setHiggsfieldConnected(false);
    }
  };

  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await fetch("/api/production/higgsfield/history");
      const data = await res.json();
      if (data.success) {
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to load studio history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .order("name", { ascending: true });

      if (!error && data) {
        setClients(data);
      }
    } catch (err) {
      console.error("Failed to load clients list:", err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/production/templates");
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  };

  const fetchClientGuidelines = async (cid: string) => {
    try {
      setLoadingGuidelines(true);
      const { data, error } = await supabase
        .from("brand_brain")
        .select("past_creatives")
        .eq("client_id", cid)
        .maybeSingle();

      if (!error && data && data.past_creatives) {
        const list = Array.isArray(data.past_creatives) ? data.past_creatives : [];
        interface PastCreativeItem {
          type?: string;
          url?: string;
          [key: string]: unknown;
        }
        const imageUrls = (list as PastCreativeItem[])
          .filter((item) => item.type === "image" && item.url)
          .map((item) => item.url as string);
        setGuidelineImages(imageUrls);
      }
    } catch (err) {
      console.error("Failed to fetch client guidelines images:", err);
    } finally {
      setLoadingGuidelines(false);
    }
  };

  const fetchMonthlyCredits = async () => {
    try {
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data, error } = await supabase
        .from("gen_costs")
        .select("cost")
        .gte("created_at", startOfMonth);

      if (!error && data) {
        const total = data.reduce((sum, item) => sum + Number(item.cost), 0);
        setMonthlyCredits(total);
        setCreditAlert(total >= HIGGSFIELD_CONFIG.monthlyLimitAlert);
      }
    } catch (err) {
      console.error("Failed to load monthly credit costs:", err);
    }
  };

  // Upload Style Reference handler
  const handleStyleUpload = async (file: File) => {
    if (!file) return;
    setUploadingStyle(true);
    setStyleUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/production/higgsfield/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStyleReference({
          mediaUrl: data.mediaUrl,
          higgsfieldMediaRef: data.higgsfieldMediaRef,
          fileName: data.fileName
        });
      } else {
        setStyleUploadError(data.error || "Style upload failed");
      }
    } catch (err) {
      setStyleUploadError("Error uploading style reference");
    } finally {
      setUploadingStyle(false);
    }
  };

  // Upload Product Image handler
  const handleProductUpload = async (file: File) => {
    if (!file) return;
    if (productImages.length >= 10) {
      setProductUploadError("Maximum of 10 product images allowed");
      return;
    }
    setUploadingProduct(true);
    setProductUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/production/higgsfield/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setProductImages(prev => [
          ...prev,
          { mediaUrl: data.mediaUrl, higgsfieldMediaRef: data.higgsfieldMediaRef, fileName: data.fileName }
        ]);
      } else {
        setProductUploadError(data.error || "Product upload failed");
      }
    } catch (err) {
      setProductUploadError("Error uploading product image");
    } finally {
      setUploadingProduct(false);
    }
  };

  const removeProductImage = (indexToRemove: number) => {
    setProductImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Quick-Attach: appends guidelines images directly to the products list
  const handleAttachGuideline = (gUrl: string, idx: number) => {
    if (productImages.length >= 10) return;
    setProductImages(prev => [
      ...prev,
      { mediaUrl: gUrl, higgsfieldMediaRef: `brand-reference-${idx}`, fileName: `brand-guideline-${idx}.jpg` }
    ]);
  };

  // Generate Image Handler
  const handleGenerate = async () => {
    if (!prompt.trim() || productImages.length === 0) return;

    setGenerating(true);
    setGenerationProgress(0);
    setGenerationError(null);

    try {
      const res = await fetch("/api/production/higgsfield/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          ratio: selectedRatio,
          styleReference, // Shared style reference input
          productImages, // Product images driving the batch count
          taskId: taskId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start generation job");
      }

      if (data.creditWarning) {
        setCreditAlert(true);
      }
      setMonthlyCredits(data.totalCredits || monthlyCredits);

      // Start polling for status respecting server pollAfterSeconds
      pollJobStatus(data.jobId, data.pollAfterSeconds || 3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerationError(msg || "An unexpected error occurred");
      setGenerating(false);
    }
  };

  const pollJobStatus = (jobId: string, initialPollAfter: number = 3) => {
    let currentInterval = Math.max(initialPollAfter * 1000, 2000);
    let timerId: NodeJS.Timeout | null = null;

    const runPoll = async () => {
      try {
        const res = await fetch(`/api/production/higgsfield/status/${jobId}`);
        const data = await res.json();

        if (!res.ok || data.status === "failed" || data.status === "timed_out" || data.status === "nsfw" || data.status === "ip_detected") {
          if (timerId) clearTimeout(timerId);
          const failureMsg = data.error || `Generation ${data.status || "failed"}.`;
          setGenerationError(failureMsg);
          setGenerating(false);
          return;
        }

        if (data.status === "completed") {
          if (timerId) clearTimeout(timerId);
          setGenerating(false);
          setPrompt("");
          setStyleReference(null);
          setProductImages([]);
          setLastPrompt(null);
          fetchHistory();
          fetchMonthlyCredits();
          return;
        }

        // Still processing - schedule next poll respecting poll_after_seconds
        if (data.status === "processing") {
          setGenerationProgress(data.progress || 0);
          if (typeof data.pollAfterSeconds === "number") {
            currentInterval = Math.max(data.pollAfterSeconds * 1000, 2000);
          }
          timerId = setTimeout(runPoll, currentInterval);
        }
      } catch (err: unknown) {
        if (timerId) clearTimeout(timerId);
        const msg = err instanceof Error ? err.message : String(err);
        setGenerationError(msg || "Checking status failed");
        setGenerating(false);
      }
    };

    timerId = setTimeout(runPoll, currentInterval);
  };

  // Apply Prompt Template with Undo
  const handleApplyTemplate = (tpl: PromptTemplateItem) => {
    setLastPrompt(prompt); // Save current prompt for undo
    setPrompt(tpl.prompt_text);
    
    if (tpl.default_model === "nano_banana") {
      setSelectedModel("Nano Banana 2");
    } else if (tpl.default_model === "gpt_image") {
      setSelectedModel("Nano Banana Pro");
    }
    
    if (tpl.default_ratio) {
      setSelectedRatio(tpl.default_ratio);
    }
  };

  const handleUndoTemplate = () => {
    if (lastPrompt !== null) {
      setPrompt(lastPrompt);
      setLastPrompt(null);
    }
  };

  // Copy parameters for Regenerating
  const handleRegenerate = (record: GenerationRecord) => {
    setPrompt(record.prompt);
    setSelectedModel(record.model);
    setSelectedRatio(record.ratio);
    
    // Fill product images with this single product image to start
    if (record.reference_image_url) {
      setProductImages([
        {
          mediaUrl: record.reference_image_url,
          higgsfieldMediaRef: record.higgsfield_media_ref || "regenerate-reference",
          fileName: "regenerated-image.jpg"
        }
      ]);
    } else {
      setProductImages([]);
    }
    setStyleReference(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Save to Client Brand Brain (Standalone Mode)
  const handleSaveToClient = async () => {
    if (!savingRecord || !selectedClientId) return;

    setSavingToBrain(true);
    setSaveSuccessMessage(null);

    try {
      const res = await fetch(`/api/brand-brain/${selectedClientId}/creatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savingRecord.prompt.substring(0, 50),
          type: "image",
          url: savingRecord.generated_image_url,
          platform: "studio",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to append creative asset");
      }

      setSaveSuccessMessage("Creative asset successfully synchronized to Brand Brain!");
      setTimeout(() => {
        setSavingRecord(null);
        setSelectedClientId("");
        setSaveSuccessMessage(null);
      }, 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Save error: ${msg}`);
    } finally {
      setSavingToBrain(false);
    }
  };

  // Use for this Task (Task Mode Pipeline Trigger)
  const handleUseForTask = async (record: GenerationRecord) => {
    if (!taskId) return;
    setAttachingToTask(record.id);

    try {
      const uploadRes = await fetch(`/api/tasks/${taskId}/upload-creative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: record.generated_image_url,
          caption: `Generated in Higgsfield Image Studio using model: ${record.model}.`,
        }),
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        throw new Error(errData.error || "Creative upload task linkage failed");
      }

      await fetch(`/api/tasks/${taskId}/qc-check`, { method: "POST" });

      const statusRes = await fetch(`/api/tasks/${taskId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review" }),
      });

      if (!statusRes.ok) {
        throw new Error("Task status advancement to review failed");
      }

      router.push("/dashboard/production");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Pipeline linkage failed: ${msg}`);
      setAttachingToTask(null);
    }
  };

  // Cost calculation (based on product images count)
  const costPerImage = HIGGSFIELD_CONFIG.modelCosts[selectedModel as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;
  const totalCostEstimate = productImages.length * costPerImage;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Connection Warning Banner */}
      {higgsfieldConnected === false && (
        <div className="bg-amber-950/20 border border-amber-900/60 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <div className="space-y-1">
            <span className="bg-amber-500/20 text-amber-300 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-indigo-500/30">
              Integration Warning
            </span>
            <div className="text-xs text-white font-semibold">
              Higgsfield is not connected. Connect it in settings to enable image generation.
            </div>
          </div>
          <Link
            href="/dashboard/settings/integrations"
            className="inline-flex items-center space-x-1.5 text-[10px] text-white hover:text-white font-bold bg-amber-600 hover:bg-amber-500 px-3.5 py-2 rounded-xl transition-all shadow-md shadow-amber-950/30 cursor-pointer"
          >
            <span>Connect Higgsfield</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
      {/* Task Mode Context Banner */}
      {taskId && (
        <div className="bg-indigo-950/40 border border-indigo-900 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <div className="space-y-1">
            <span className="bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-indigo-500/30">
              Task Workspace Mode
            </span>
            <div className="text-xs text-white font-semibold">
              Generating for: <span className="text-indigo-400 font-bold">{clientName}</span> — <span className="text-slate-200">{taskName}</span>
            </div>
            {plannedDate && (
              <span className="text-[10px] text-slate-500 block">
                Planned Deadline: {new Date(plannedDate).toLocaleDateString()}
              </span>
            )}
          </div>
          <Link
            href="/dashboard/production"
            className="inline-flex items-center space-x-1.5 text-[10px] text-slate-400 hover:text-white font-bold bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Production Board</span>
          </Link>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
            <Cpu className="w-4 h-4" />
            <span>AI Production Sandbox</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Image Studio</h1>
          <p className="text-slate-400 text-xs mt-1">
            Create high-fidelity promotional ad layouts and visuals utilizing Higgsfield engines
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSyncFromHiggsfield}
            disabled={syncing}
            className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-850 border border-indigo-900/50 hover:border-indigo-500/50 text-indigo-300 hover:text-white text-xs font-bold py-3 px-4 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            ) : (
              <RefreshCw className="w-4 h-4 text-indigo-400" />
            )}
            <span>Sync from Higgsfield</span>
          </button>

          {/* Credit Alert Metric Box */}
          <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 flex flex-col justify-center min-w-[200px]">
            <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              <span>Higgsfield Credits Usage</span>
              {creditAlert && (
                <span className="flex items-center space-x-1 text-amber-500">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Limit warning</span>
                </span>
              )}
            </div>
            <div className="flex items-baseline space-x-1 mt-1.5">
              <span className="text-2xl font-black text-white">{monthlyCredits.toFixed(1)}</span>
              <span className="text-[10px] font-semibold text-slate-500">/ {HIGGSFIELD_CONFIG.monthlyLimitAlert} credits</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-1 mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  creditAlert ? "bg-amber-500" : "bg-indigo-600"
                }`}
                style={{ width: `${Math.min((monthlyCredits / HIGGSFIELD_CONFIG.monthlyLimitAlert) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {syncSuccessMessage && (
        <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-2xl p-4 flex items-center justify-between text-xs text-emerald-300 animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{syncSuccessMessage}</span>
          </div>
          <button onClick={() => setSyncSuccessMessage(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Form Glassmorphic Card */}
      <div className="bg-slate-950/40 border border-slate-900 backdrop-blur-md rounded-3xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full blur-[60px] pointer-events-none" />

        {/* SECTION 1: Style Reference Upload Slot */}
        <div className="space-y-2 border-b border-slate-900/60 pb-5">
          <div className="flex justify-between items-baseline">
            <label className="text-xs font-bold text-purple-400 uppercase tracking-wider block">
              Section 1 — Style Reference
            </label>
            <span className="text-[10px] text-slate-500">Optional</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Reference image — sets the style/scene for all outputs
          </p>

          <input
            type="file"
            ref={styleFileInputRef}
            className="hidden"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleStyleUpload(file);
            }}
          />

          {!styleReference ? (
            <div
              onClick={() => higgsfieldConnected === true && styleFileInputRef.current?.click()}
              className={`w-full border border-dashed rounded-2xl p-4 text-center transition-all flex items-center justify-center space-x-2.5 group ${
                higgsfieldConnected !== true
                  ? "border-slate-900 bg-slate-950/20 text-slate-600 cursor-not-allowed opacity-50"
                  : "border-purple-500/35 hover:border-purple-500/65 bg-purple-950/5 hover:bg-purple-950/10 cursor-pointer text-slate-350"
              }`}
            >
              {uploadingStyle ? (
                <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
              ) : (
                <Palette className="w-4 h-4 text-purple-500/70 group-hover:text-purple-400 transition-colors" />
              )}
              <span className="text-xs text-slate-350 font-medium">
                {uploadingStyle ? "Uploading Style Reference..." : "Upload style/scene image reference"}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-3.5 bg-purple-950/10 border border-purple-900/30 p-2.5 rounded-2xl w-fit animate-in zoom-in-95 duration-100">
              <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-950 border border-purple-900/20">
                <img
                  src={styleReference.mediaUrl}
                  alt="Style Reference"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="pr-2">
                <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Style Reference Applied</p>
                <span className="text-[9px] font-mono text-slate-500 mt-0.5 block truncate max-w-[150px]">
                  {styleReference.higgsfieldMediaRef}
                </span>
              </div>
              <button
                onClick={() => setStyleReference(null)}
                className="w-6 h-6 rounded-lg hover:bg-slate-900 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {styleUploadError && (
            <p className="text-[10px] text-red-400 font-semibold flex items-center space-x-1 mt-1">
              <AlertTriangle className="w-3 h-3" />
              <span>{styleUploadError}</span>
            </p>
          )}
        </div>

        {/* SECTION 2: Product Images Batch (1 to 10) */}
        <div className="space-y-2.5">
          <div className="flex justify-between items-baseline">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Section 2 — Product Images
            </label>
            <span className="text-[10px] font-bold text-indigo-400">{productImages.length}/10 uploaded</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Products to generate (1–10) — drives the total generation count
          </p>

          <input
            type="file"
            ref={productFileInputRef}
            className="hidden"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleProductUpload(file);
            }}
          />

          <div className="grid grid-cols-5 gap-3.5 w-fit">
            {productImages.map((prodImg, index) => (
              <div
                key={index}
                className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 group animate-in zoom-in-50 duration-150"
              >
                <img
                  src={prodImg.mediaUrl}
                  alt={prodImg.fileName}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-1 left-1 bg-slate-950/80 backdrop-blur-md rounded-full p-0.5" title="Higgsfield Media Ready">
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                </div>
                <button
                  onClick={() => removeProductImage(index)}
                  className="absolute top-1 right-1 w-4 h-4 bg-red-600/90 border border-red-500/30 rounded flex items-center justify-center text-white cursor-pointer opacity-80 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {productImages.length < 10 && (
              <div
                onClick={() => higgsfieldConnected === true && productFileInputRef.current?.click()}
                className={`w-16 h-16 rounded-xl border border-dashed flex flex-col items-center justify-center transition-all duration-150 group ${
                  higgsfieldConnected !== true
                    ? "border-slate-900 bg-slate-950/20 cursor-not-allowed opacity-50"
                    : "border-slate-800 hover:border-indigo-500 bg-slate-900/10 hover:bg-indigo-950/5 cursor-pointer"
                }`}
              >
                {uploadingProduct ? (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                ) : (
                  <Plus className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                )}
              </div>
            )}
          </div>

          {productUploadError && (
            <p className="text-[10px] text-red-400 font-semibold flex items-center space-x-1">
              <AlertTriangle className="w-3 h-3" />
              <span>{productUploadError}</span>
            </p>
          )}

          {/* Quick-Attach Client Brand Brain Guidelines References */}
          {taskId && guidelineImages.length > 0 && (
            <div className="space-y-1.5 border-t border-slate-900/40 pt-2.5">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                Quick-Attach Brand References ({guidelineImages.length})
              </span>
              {loadingGuidelines ? (
                <div className="flex items-center space-x-1 text-[9px] text-slate-650">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading brand brain...</span>
                </div>
              ) : (
                <div className="flex space-x-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {guidelineImages.map((gUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={productImages.length >= 10}
                      onClick={() => handleAttachGuideline(gUrl, idx)}
                      className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-850 hover:border-indigo-500 disabled:opacity-40 flex-shrink-0 transition-colors"
                      title="Attach as product"
                    >
                      <img src={gUrl} alt="guidelines ref" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. Model selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Select Generation Model
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onClick={() => setSelectedModel("Nano Banana 2")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                selectedModel === "Nano Banana 2"
                  ? "bg-indigo-950/20 border-indigo-500/80 shadow-lg shadow-indigo-950/40"
                  : "bg-slate-950/80 border-slate-900 hover:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">Nano Banana 2</h4>
                  <p className="text-[10px] text-slate-500 mt-1">Speed-optimized outputs for fast mockups</p>
                </div>
                <div
                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    selectedModel === "Nano Banana 2"
                      ? "border-indigo-500 bg-indigo-500"
                      : "border-slate-800"
                  }`}
                >
                  {selectedModel === "Nano Banana 2" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>
            </div>

            <div
              onClick={() => setSelectedModel("Nano Banana Pro")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                selectedModel === "Nano Banana Pro"
                  ? "bg-indigo-950/20 border-indigo-500/80 shadow-lg shadow-indigo-950/40"
                  : "bg-slate-950/80 border-slate-900 hover:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <span>Nano Banana Pro</span>
                    <span className="bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border border-indigo-500/30">
                      Default
                    </span>
                  </h4>
                  <p className="text-[10px] text-slate-500 mt-1">High-quality, stylized ad layouts and assets</p>
                </div>
                <div
                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    selectedModel === "Nano Banana Pro"
                      ? "border-indigo-500 bg-indigo-500"
                      : "border-slate-800"
                  }`}
                >
                  {selectedModel === "Nano Banana Pro" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Aspect ratio and 4. Resolution */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Aspect Ratio
            </label>
            <div className="flex space-x-2">
              {["9:16", "3:4", "1:1"].map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setSelectedRatio(ratio)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    selectedRatio === ratio
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-slate-950 border-slate-900 text-slate-400 hover:text-white"
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 md:text-right">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              Resolution
            </label>
            <div className="inline-flex items-center space-x-1.5 bg-slate-900/60 border border-slate-880 px-3 py-1.5 rounded-full text-xs text-slate-400">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-bold text-slate-300">1K (Fixed)</span>
            </div>
          </div>
        </div>

        {/* Active prompt templates chips library */}
        {templates.length > 0 && (
          <div className="space-y-2 border-t border-slate-900/60 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Apply Template presets
              </span>
              {lastPrompt !== null && (
                <button
                  type="button"
                  onClick={handleUndoTemplate}
                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 transition-colors"
                >
                  <Undo className="w-3.5 h-3.5" />
                  <span>Undo Change</span>
                </button>
              )}
            </div>

            <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-thin max-w-full">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleApplyTemplate(tpl)}
                  className="bg-indigo-950/15 hover:bg-indigo-900/25 border border-indigo-900/30 hover:border-indigo-800 text-indigo-300 px-3 py-1.5 rounded-xl text-[10px] font-semibold cursor-pointer transition-all shrink-0"
                  title={tpl.prompt_text}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. Prompt text area & Generate */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Creative Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            placeholder="Describe the image you want to generate in detail (e.g. 'Studio shot of a luxury smartwatch resting on black polished quartz stone, soft backlighting, dramatic product photography'...)"
            rows={4}
            className="w-full bg-slate-950/80 border border-slate-900 focus:border-indigo-500/50 rounded-2xl p-4 text-xs text-white placeholder-slate-650 focus:outline-none transition-colors"
          />

          {generationError && (
            <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-xl text-red-200 text-[10px] flex items-center space-x-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{generationError}</span>
            </div>
          )}

          {/* Dynamic Cost Estimate Preview Panel (Driven ONLY by Product Images) */}
          {productImages.length > 0 && (
            <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-2xl p-3 text-xs text-indigo-300 font-semibold flex items-center justify-between animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>
                  {productImages.length} {productImages.length === 1 ? "image" : "images"} &times; {selectedModel} = ~{totalCostEstimate.toFixed(1)} credits.
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-normal">Est. cost log</span>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || productImages.length === 0 || higgsfieldConnected !== true}
            className={`w-full py-3.5 px-6 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${
              generating
                ? "bg-slate-900 border border-slate-800 text-slate-550"
                : (higgsfieldConnected !== true)
                ? "bg-amber-950/10 border border-amber-950/30 text-amber-500/60 cursor-not-allowed"
                : (!prompt.trim() || productImages.length === 0)
                ? "bg-slate-950 border border-slate-900 text-slate-650 cursor-not-allowed"
                : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-950/50 cursor-pointer"
            }`}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-indigo-450" />
                <span>Generating Batch... ({generationProgress}%)</span>
              </>
            ) : higgsfieldConnected === false ? (
              <span>Higgsfield Not Connected</span>
            ) : productImages.length === 0 ? (
              <span>Upload product images to begin</span>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Generate Higgsfield Batch ({productImages.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 6. Results area / History Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center space-x-2">
          <ImageIcon className="w-5 h-5 text-indigo-400" />
          <span>Studio Workspace Gallery</span>
        </h2>

        {loadingHistory ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-2 bg-slate-950/20 border border-slate-900/50 rounded-3xl">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-500">Loading gallery history...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="bg-slate-950/20 border border-slate-900/50 rounded-3xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-300">No images generated yet</h3>
              <p className="text-xs text-slate-500 mt-1">Provide a prompt above and generate your first custom asset.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Active Generating or Error Card Tile */}
            {(generating || generationError) && (
              <div className={`p-6 rounded-3xl border flex flex-col justify-between space-y-4 animate-in fade-in duration-200 ${
                generationError ? "bg-red-950/20 border-red-900/60" : "bg-indigo-950/20 border-indigo-900/60"
              }`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                    generationError ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                  }`}>
                    {generationError ? "Generation Failed / Flagged" : `Generating (${selectedModel})`}
                  </span>
                  {generationError && (
                    <button onClick={() => setGenerationError(null)} className="text-slate-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                  {generating ? (
                    <>
                      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                      <div className="w-full space-y-1">
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                          <span>Polling job_status...</span>
                          <span>{generationProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${generationProgress}%` }} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-8 h-8 text-red-400" />
                      <p className="text-xs text-red-300 font-medium max-w-sm">{generationError}</p>
                      <button
                        onClick={handleSyncFromHiggsfield}
                        disabled={syncing}
                        className="mt-2 inline-flex items-center space-x-1.5 bg-red-950/40 hover:bg-red-900/40 border border-red-800 text-red-200 text-[10px] font-bold py-1.5 px-3 rounded-xl transition-all cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                        <span>Check Status / Sync</span>
                      </button>
                    </>
                  )}
                </div>

                <p className="text-xs text-slate-400 line-clamp-2 italic">
                  &ldquo;{prompt || "Active Higgsfield Job"}&rdquo;
                </p>
              </div>
            )}

            {history.map((record) => (
              <div
                key={record.id}
                className="bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden flex flex-col group relative hover:border-slate-800 transition-all"
              >
                {/* Generation specs label badge overlay */}
                <div className="absolute top-3 left-3 bg-slate-950/70 border border-slate-800 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] font-bold text-slate-300 z-10">
                  {record.model} ({record.ratio})
                </div>

                {/* Main image content frame */}
                <div className="relative aspect-video w-full bg-slate-950 overflow-hidden flex items-center justify-center border-b border-slate-900">
                  <img
                    src={record.generated_image_url}
                    alt={record.prompt}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                </div>

                {/* Body Details */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                    {record.prompt}
                  </p>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[9px] font-semibold text-slate-500">
                      <span>Cost: {Number(record.cost).toFixed(1)} cr</span>
                      <span>{new Date(record.created_at).toLocaleDateString()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-slate-900 pt-3">
                      {/* Download */}
                      <button
                        onClick={() => window.open(record.generated_image_url, "_blank")}
                        className="py-1.5 px-2 bg-slate-900/60 hover:bg-slate-900 border border-slate-850 rounded-xl text-[10px] font-bold text-slate-350 flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Open</span>
                      </button>

                      {/* Regenerate */}
                      <button
                        onClick={() => handleRegenerate(record)}
                        className="py-1.5 px-2 bg-slate-900/60 hover:bg-slate-900 border border-slate-850 rounded-xl text-[10px] font-bold text-slate-355 flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Re-use</span>
                      </button>

                      {/* Link to Task OR Save to Client depending on mode */}
                      {taskId ? (
                        <button
                          disabled={attachingToTask !== null}
                          onClick={() => handleUseForTask(record)}
                          className="py-1.5 px-2 bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-900 rounded-xl text-[10px] font-bold text-indigo-400 flex items-center justify-center space-x-1 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          {attachingToTask === record.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5" />
                          )}
                          <span>Use Task</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setSavingRecord(record)}
                          className="py-1.5 px-2 bg-slate-900/60 hover:bg-slate-900 border border-slate-850 rounded-xl text-[10px] font-bold text-indigo-455 flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          <span>Save To</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save to Client Drawer/Modal Dialog (Only available in Standalone Mode) */}
      {savingRecord && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Save Visual to Client Brain</h3>
              <button
                onClick={() => {
                  setSavingRecord(null);
                  setSelectedClientId("");
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {saveSuccessMessage ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
                <p className="text-xs text-slate-300 text-center font-bold">{saveSuccessMessage}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Select Client Brand
                  </label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Client --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-[10px] text-slate-500 leading-normal">
                  Saving this asset will insert it directly into the client&apos;s permanent Brand Brain creatives list for future campaign use.
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    onClick={() => {
                      setSavingRecord(null);
                      setSelectedClientId("");
                    }}
                    className="flex-1 py-2 bg-slate-950 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!selectedClientId || savingToBrain}
                    onClick={handleSaveToClient}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold rounded-xl flex items-center justify-center space-x-1"
                  >
                    {savingToBrain && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{savingToBrain ? "Syncing..." : "Confirm Save"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImageStudioPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center py-20 bg-slate-950/20 border border-slate-900/50 rounded-3xl">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        <p className="text-xs text-slate-500">Initializing Image Studio...</p>
      </div>
    }>
      <ImageStudioWorkspace />
    </Suspense>
  );
}
