"use client";

import React, { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles,
  ChevronLeft,
  Loader2,
  Save,
  MessageSquare,
  Upload,
  User,
  Palette,
  Type,
  Plus,
  Trash,
  ShieldAlert,
  X,
  AlertTriangle,
  CheckCircle
} from "lucide-react";

interface ClientProfile {
  id: string;
  name: string;
  logo_url?: string;
  guidelines_url?: string;
  social_accounts?: Record<string, string>;
  products?: string[];
  target_audience?: string;
  deliverables_per_month?: number;
  ad_budget?: number;
  whatsapp_group_id?: string;
}

interface CreativeAsset {
  name: string;
  type: "image" | "video" | "carousel";
  url: string;
  platform: string;
  uploadedAt: string;
}

interface FeedbackComment {
  date: string;
  sender: "founder" | "client";
  comment: string;
}

interface BrandBrainProfile {
  id: string;
  client_id: string;
  colors: string[];
  fonts: string[];
  caption_tone?: string;
  design_preferences: Record<string, string>;
  addresses: Record<string, unknown>[];
  past_creatives: CreativeAsset[];
  feedback_log: FeedbackComment[];
  results_log: Record<string, unknown>[];
  brand_brief?: string;
}

export default function ClientBrandBrainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: clientId } = use(params);
  const router = useRouter();
  const supabase = createClient();

  // Core Data State
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [brandBrain, setBrandBrain] = useState<BrandBrainProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<"brief" | "styling" | "creatives" | "feedback">("brief");

  // Brief Generation State
  const [generatingBrief, setGeneratingBrief] = useState(false);

  // Edit Guidelines States
  const [editingGuidelines, setEditingGuidelines] = useState(false);
  const [colorInput, setColorInput] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [fontHeading, setFontHeading] = useState("");
  const [fontBody, setFontBody] = useState("");
  const [captionTone, setCaptionTone] = useState("");
  
  // Design Preferences JSON key-values
  const [prefKeys, setPrefKeys] = useState<string[]>([]);
  const [prefVals, setPrefVals] = useState<string[]>([]);

  // Add Feedback States
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSender, setFeedbackSender] = useState<"founder" | "client">("founder");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Upload Creative States
  const [uploadingCreative, setUploadingCreative] = useState(false);
  const [creativeName, setCreativeName] = useState("");
  const [creativeType, setCreativeType] = useState<"image" | "video" | "carousel">("image");
  const [creativePlatform, setCreativePlatform] = useState("instagram");
  const [creativeFile, setCreativeFile] = useState<File | null>(null);

  // Knowledge Import States
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedFileSize, setUploadedFileSize] = useState(0);

  // Extracted entries checklist states
  const [extractedData, setExtractedData] = useState<{
    facts: string[];
    preferences: string[];
    learnings: string[];
    feedback: string[];
  } | null>(null);

  const [selectedFacts, setSelectedFacts] = useState<string[]>([]);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);
  const [selectedLearnings, setSelectedLearnings] = useState<string[]>([]);
  const [selectedFeedback, setSelectedFeedback] = useState<string[]>([]);

  const [confirmingImport, setConfirmingImport] = useState(false);

  // Fetch core client profiles
  const fetchData = async () => {
    try {
      const response = await fetch(`/api/brand-brain/${clientId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load brand data");
      }
      setClient(data.client);
      setBrandBrain(data.brandBrain || null);
      
      // Initialize edit fields
      setColors(data.brandBrain?.colors || []);
      setFontHeading(data.brandBrain?.fonts?.[0] || "");
      setFontBody(data.brandBrain?.fonts?.[1] || "");
      setCaptionTone(data.brandBrain?.caption_tone || "");

      // Preferences map
      const prefs = data.brandBrain?.design_preferences || {};
      setPrefKeys(Object.keys(prefs));
      setPrefVals(Object.values(prefs));
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Color controls
  const handleAddColor = () => {
    if (colorInput.trim() && !colors.includes(colorInput.trim())) {
      setColors([...colors, colorInput.trim()]);
      setColorInput("");
    }
  };

  const handleRemoveColor = (idx: number) => {
    setColors(colors.filter((_, i) => i !== idx));
  };

  // Preference list builders
  const handleAddPreference = () => {
    setPrefKeys([...prefKeys, ""]);
    setPrefVals([...prefVals, ""]);
  };

  const handleRemovePreference = (index: number) => {
    setPrefKeys(prefKeys.filter((_, i) => i !== index));
    setPrefVals(prefVals.filter((_, i) => i !== index));
  };

  const handlePrefKeyChange = (index: number, val: string) => {
    const updated = [...prefKeys];
    updated[index] = val;
    setPrefKeys(updated);
  };

  const handlePrefValChange = (index: number, val: string) => {
    const updated = [...prefVals];
    updated[index] = val;
    setPrefVals(updated);
  };

  // Save Guidelines PUT Action
  const handleSaveGuidelines = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const designPreferences: Record<string, string> = {};
    prefKeys.forEach((k, i) => {
      if (k.trim()) {
        designPreferences[k.trim()] = prefVals[i].trim();
      }
    });

    try {
      const response = await fetch(`/api/brand-brain/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: client?.name,
          deliverablesPerMonth: client?.deliverables_per_month,
          adBudget: client?.ad_budget,
          whatsappGroupId: client?.whatsapp_group_id,
          targetAudience: client?.target_audience,
          products: client?.products,
          colors,
          fonts: [fontHeading, fontBody].filter(Boolean),
          captionTone,
          designPreferences,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to save styling guidelines");
      }

      setEditingGuidelines(false);
      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred while saving.");
      setLoading(false);
    }
  };

  // Knowledge Import Handlers
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingFile(true);
    setImportError(null);
    setExtractedData(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/brand-brain/${clientId}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process knowledge import file");
      }

      setUploadedFileName(data.fileName);
      setUploadedFileSize(data.fileSize);
      setExtractedData(data.extracted);

      // Pre-select all extracted items
      setSelectedFacts(data.extracted.facts || []);
      setSelectedPrefs(data.extracted.preferences || []);
      setSelectedLearnings(data.extracted.learnings || []);
      setSelectedFeedback(data.extracted.feedback || []);
    } catch (err: any) {
      console.error(err);
      setImportError(err.message || "An unexpected error occurred during import extraction");
    } finally {
      setImportingFile(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleConfirmImport = async () => {
    setConfirmingImport(true);
    setImportError(null);

    try {
      const res = await fetch(`/api/brand-brain/${clientId}/import`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facts: selectedFacts,
          preferences: selectedPrefs,
          learnings: selectedLearnings,
          feedback: selectedFeedback,
          fileName: uploadedFileName,
          fileSize: uploadedFileSize
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save approved import entries");
      }

      setIsImportModalOpen(false);
      setExtractedData(null);
      await fetchData();
      alert("Brand knowledge successfully imported and brief regenerated!");
    } catch (err: any) {
      console.error(err);
      setImportError(err.message || "Failed to confirm and synchronize brand brain imports");
    } finally {
      setConfirmingImport(false);
    }
  };

  const toggleFact = (item: string) => {
    if (selectedFacts.includes(item)) {
      setSelectedFacts(selectedFacts.filter(x => x !== item));
    } else {
      setSelectedFacts([...selectedFacts, item]);
    }
  };

  const togglePref = (item: string) => {
    if (selectedPrefs.includes(item)) {
      setSelectedPrefs(selectedPrefs.filter(x => x !== item));
    } else {
      setSelectedPrefs([...selectedPrefs, item]);
    }
  };

  const toggleLearning = (item: string) => {
    if (selectedLearnings.includes(item)) {
      setSelectedLearnings(selectedLearnings.filter(x => x !== item));
    } else {
      setSelectedLearnings([...selectedLearnings, item]);
    }
  };

  const toggleFeedback = (item: string) => {
    if (selectedFeedback.includes(item)) {
      setSelectedFeedback(selectedFeedback.filter(x => x !== item));
    } else {
      setSelectedFeedback([...selectedFeedback, item]);
    }
  };

  // Generate Brief LLM Action
  const handleGenerateBrief = async () => {
    setGeneratingBrief(true);
    setError(null);

    try {
      const response = await fetch(`/api/brand-brain/${clientId}/brief`, {
        method: "POST",
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate brand brief");
      }

      setBrandBrain(data.brandBrain);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to complete AI Brief synthesis.");
    } finally {
      setGeneratingBrief(false);
    }
  };

  // Add feedback POST Action
  const handleAddFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackComment.trim()) return;

    setSubmittingFeedback(true);
    setError(null);

    try {
      const response = await fetch(`/api/brand-brain/${clientId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment: feedbackComment,
          sender: feedbackSender,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit comment");
      }

      if (brandBrain) {
        setBrandBrain({
          ...brandBrain,
          feedback_log: data.feedbackLog,
        });
      }
      setFeedbackComment("");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to add comment.");
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // Upload Past Creative POST Action
  const handleUploadCreative = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creativeFile || !creativeName.trim()) return;

    setUploadingCreative(true);
    setError(null);

    try {
      // 1. Upload to Supabase Storage
      const fileExt = creativeFile.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `creatives/${fileName}`;

      const { data, error: uploadErr } = await supabase.storage
        .from("brand-assets")
        .upload(filePath, creativeFile, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadErr) {
        throw new Error(`Storage upload failed: ${uploadErr.message}`);
      }

      // 2. Log reference in database
      const response = await fetch(`/api/brand-brain/${clientId}/creatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: creativeName,
          type: creativeType,
          url: data.path,
          platform: creativePlatform,
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Failed to log creative profile in DB");
      }

      if (brandBrain) {
        setBrandBrain({
          ...brandBrain,
          past_creatives: resData.pastCreatives,
        });
      }
      setCreativeName("");
      setCreativeFile(null);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to complete asset upload.");
    } finally {
      setUploadingCreative(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-500 font-medium">Fetching Brand Brain Guidelines...</span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center p-8 bg-slate-950/20 border border-slate-900 rounded-2xl">
        <h3 className="text-sm font-semibold text-slate-400">Client profile not found.</h3>
        <button onClick={() => router.push("/dashboard/brand-brain")} className="mt-4 text-xs text-indigo-400 font-bold hover:underline">
          Return to Hub
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Top Navigation Row */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4">
        <button
          onClick={() => router.push("/dashboard/brand-brain")}
          className="flex items-center space-x-1.5 text-xs text-slate-500 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Brand Brain Hub</span>
        </button>

        <span className="text-[10px] text-slate-600 font-mono">ID: {client.id.substring(0, 8)}...</span>
      </div>

      {/* Brand Header Card */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-950/50 border border-indigo-900/50 flex items-center justify-center text-indigo-400 font-bold text-lg uppercase shadow-inner">
            {client.name.substring(0, 2)}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white leading-tight">{client.name}</h2>
            <p className="text-xs text-slate-400 mt-1">
              Ad Budget: <span className="text-slate-300 font-semibold">INR {client.ad_budget?.toLocaleString("en-IN")}</span> / month
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4 text-[10px] uppercase font-bold text-slate-500 border-t md:border-t-0 border-slate-900 pt-3 md:pt-0">
          <div>
            <span className="block text-slate-600 text-[8px] tracking-widest">Deliverables</span>
            <span className="text-indigo-400 font-mono text-sm">{client.deliverables_per_month} / mo</span>
          </div>
          {client.whatsapp_group_id && (
            <div className="border-l border-slate-900 pl-4">
              <span className="block text-slate-600 text-[8px] tracking-widest">WhatsApp Group</span>
              <span className="text-slate-300 font-mono truncate max-w-[120px] block">{client.whatsapp_group_id}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tab Selectors - Mobile friendly scrollable list */}
      <div className="flex border-b border-slate-900 overflow-x-auto no-scrollbar scroll-smooth">
        {(["brief", "styling", "creatives", "feedback"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 px-5 text-xs font-semibold uppercase tracking-wider border-b-2 shrink-0 transition-all cursor-pointer ${
              activeTab === tab
                ? "border-indigo-500 text-white font-bold"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab === "brief" && "AI Brand Brief"}
            {tab === "styling" && "Visual Guidelines"}
            {tab === "creatives" && "Asset Gallery"}
            {tab === "feedback" && "Feedback Logs"}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 flex items-start space-x-3 text-red-200 text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Contents */}
      <div className="space-y-6">

        {/* TAB 1: Brand Brief */}
        {activeTab === "brief" && (
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-900 pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center">
                  <Sparkles className="w-4 h-4 mr-1.5 text-indigo-400" />
                  Synthesized Brief
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Central context injected into active generator agents</p>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-350 text-[10px] font-bold uppercase tracking-wider py-2 px-3.5 rounded-lg transition-all cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Knowledge</span>
                </button>

                <button
                  onClick={handleGenerateBrief}
                  disabled={generatingBrief}
                  className="flex items-center space-x-1.5 bg-indigo-950/40 border border-indigo-900 hover:bg-indigo-900/40 text-indigo-300 text-[10px] font-bold uppercase tracking-wider py-2 px-3.5 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                >
                {generatingBrief ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Synthesizing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{brandBrain?.brand_brief ? "Regenerate Brief" : "Generate Brief"}</span>
                  </>
                )}
              </button>
            </div>
          </div>

            {generatingBrief ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-xs text-indigo-300 font-semibold animate-pulse">Running AI Strategy Bot...</p>
                  <p className="text-[10px] text-slate-500">Reading audience maps, color guidelines, and historical client feedback logs...</p>
                </div>
              </div>
            ) : brandBrain?.brand_brief ? (
              <div className="prose prose-invert prose-xs max-w-none text-slate-300 leading-relaxed space-y-4 text-xs">
                {brandBrain.brand_brief.split("\n").map((line: string, idx: number) => {
                  if (line.startsWith("# ")) {
                    return <h1 key={idx} className="text-base font-extrabold text-white pt-2 border-b border-slate-900 pb-1">{line.replace("# ", "")}</h1>;
                  }
                  if (line.startsWith("## ")) {
                    return <h2 key={idx} className="text-sm font-bold text-white pt-2 text-indigo-400">{line.replace("## ", "")}</h2>;
                  }
                  if (line.startsWith("### ")) {
                    return <h3 key={idx} className="text-xs font-bold text-white pt-1 text-slate-200">{line.replace("### ", "")}</h3>;
                  }
                  if (line.startsWith("- ") || line.startsWith("* ")) {
                    return <li key={idx} className="list-disc ml-4 pl-1">{line.substring(2)}</li>;
                  }
                  if (line.trim() === "") return <div key={idx} className="h-2" />;
                  return <p key={idx}>{line}</p>;
                })}
              </div>
            ) : (
              <div className="text-center py-12 space-y-3">
                <p className="text-xs text-slate-500 font-medium">No brand brief has been generated for this client yet.</p>
                <button
                  onClick={handleGenerateBrief}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-4 rounded-xl cursor-pointer transition-all"
                >
                  Synthesize Initial Brief
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Visual Styling Rules */}
        {activeTab === "styling" && (
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6">
            {!editingGuidelines ? (
              /* Read view */
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-slate-900 pb-4">
                  <h3 className="text-sm font-bold text-white">Branding Identity & Rules</h3>
                  <button
                    onClick={() => setEditingGuidelines(true)}
                    className="text-[10px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-lg border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                  >
                    Edit Guidelines
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Colors */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center">
                      <Palette className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Color Hex Palette
                    </span>
                    <div className="flex flex-wrap gap-2.5">
                      {colors.length > 0 ? (
                        colors.map((color, idx) => (
                          <div key={idx} className="flex items-center space-x-2 bg-slate-900/50 border border-slate-800 p-2 rounded-xl text-xs font-mono text-slate-200">
                            <span className="w-4 h-4 rounded-md border border-slate-700" style={{ backgroundColor: color }} />
                            <span>{color}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-slate-600">No color hex code specified</span>
                      )}
                    </div>
                  </div>

                  {/* Fonts */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center">
                      <Type className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Typeface Typography
                    </span>
                    <div className="space-y-1.5 text-xs text-slate-300">
                      <p>Heading Font: <span className="font-bold text-indigo-400 font-mono">{fontHeading || "None"}</span></p>
                      <p>Body Font: <span className="font-semibold text-slate-200 font-mono">{fontBody || "None"}</span></p>
                    </div>
                  </div>
                </div>

                {/* Tone */}
                <div className="space-y-2 border-t border-slate-900 pt-5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Social Media Caption Copy Tone</span>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/10 border border-slate-900 p-4 rounded-xl font-medium">
                    {captionTone || "No caption tone specified yet."}
                  </p>
                </div>

                {/* Design Preferences Key-Values */}
                <div className="space-y-2.5 border-t border-slate-900 pt-5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Visual Design Preferences</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {prefKeys.length > 0 ? (
                      prefKeys.map((key, idx) => (
                        <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-xl p-3.5 text-xs">
                          <span className="block font-bold text-indigo-400 uppercase text-[9px] mb-1 tracking-wider">{key}</span>
                          <span className="text-slate-300 leading-tight block">{prefVals[idx]}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-slate-600">No preferences configured</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Edit Form view */
              <form onSubmit={handleSaveGuidelines} className="space-y-5">
                <div className="flex justify-between items-center border-b border-slate-900 pb-4">
                  <h3 className="text-sm font-bold text-white">Edit Branding Guidelines</h3>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingGuidelines(false)}
                      className="text-[10px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-lg border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-lg transition-all cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Colors Edit */}
                  <div className="space-y-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase">Colors Palette</label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        placeholder="e.g. #c21807"
                        value={colorInput}
                        onChange={(e) => setColorInput(e.target.value)}
                        className="bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all flex-1"
                      />
                      <button
                        type="button"
                        onClick={handleAddColor}
                        className="px-3 rounded-xl bg-indigo-950/40 border border-indigo-900 text-indigo-300 text-xs font-bold hover:bg-indigo-900/40 cursor-pointer"
                      >
                        Add Color
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1.5">
                      {colors.map((color, idx) => (
                        <div key={idx} className="flex items-center space-x-1.5 bg-slate-900/50 border border-slate-800 py-1.5 pl-2 pr-1.5 rounded-lg text-[10px] font-mono">
                          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                          <span>{color}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveColor(idx)}
                            className="text-slate-500 hover:text-red-400 p-0.5"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Fonts Edit */}
                  <div className="space-y-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase">Typography Fonts</label>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Heading Font (e.g. Playfair)"
                        value={fontHeading}
                        onChange={(e) => setFontHeading(e.target.value)}
                        className="bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                      />
                      <input
                        type="text"
                        placeholder="Body Font (e.g. Montserrat)"
                        value={fontBody}
                        onChange={(e) => setFontBody(e.target.value)}
                        className="bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Tone Edit */}
                <div className="space-y-3 pt-3 border-t border-slate-900">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Social Media Caption Tone Guideline</label>
                  <textarea
                    rows={3}
                    placeholder="Describe brand caption copy rules (e.g. Warm, nostalgic, spices-heritage focus...)"
                    value={captionTone}
                    onChange={(e) => setCaptionTone(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all resize-none"
                  />
                </div>

                {/* Preferences Edit */}
                <div className="space-y-3 pt-3 border-t border-slate-900">
                  <div className="flex justify-between items-center">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase">Visual Preferences</label>
                    <button
                      type="button"
                      onClick={handleAddPreference}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-900 text-[9px] font-bold text-indigo-300 hover:bg-indigo-900/40 transition-all cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Preference</span>
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
                    {prefKeys.map((key, idx) => (
                      <div key={idx} className="flex items-center space-x-3">
                        <input
                          type="text"
                          placeholder="Key (e.g. imagery)"
                          value={key}
                          onChange={(e) => handlePrefKeyChange(idx, e.target.value)}
                          className="w-[120px] bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Value (e.g. warm close-ups)"
                          value={prefVals[idx]}
                          onChange={(e) => handlePrefValChange(idx, e.target.value)}
                          className="flex-1 bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePreference(idx)}
                          className="text-slate-500 hover:text-red-400 p-2 cursor-pointer"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* TAB 3: Past Creatives Asset Gallery */}
        {activeTab === "creatives" && (
          <div className="space-y-6">
            {/* Upload form block */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center">
                <Upload className="w-4 h-4 mr-1.5 text-indigo-400" />
                Upload Past Creative
              </h3>
              
              <form onSubmit={handleUploadCreative} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end text-xs">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Asset Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pickle Launch Reel"
                    value={creativeName}
                    onChange={(e) => setCreativeName(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Upload File</label>
                  <input
                    type="file"
                    required
                    accept="image/*,video/*"
                    onChange={(e) => setCreativeFile(e.target.files?.[0] || null)}
                    className="w-full text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[10px] file:font-semibold file:bg-indigo-950/30 file:text-indigo-400 hover:file:bg-indigo-900/30 file:cursor-pointer"
                  />
                </div>
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Asset Type</label>
                    <select
                      value={creativeType}
                      onChange={(e) => setCreativeType(e.target.value as "image" | "video" | "carousel")}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="carousel">Carousel</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Platform</label>
                    <select
                      value={creativePlatform}
                      onChange={(e) => setCreativePlatform(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                    >
                      <option value="instagram">Instagram</option>
                      <option value="facebook">Facebook</option>
                      <option value="youtube">YouTube</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={uploadingCreative}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {uploadingCreative ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Upload</span>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Creatives listings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {brandBrain?.past_creatives && brandBrain.past_creatives.length > 0 ? (
                brandBrain.past_creatives.map((creative: CreativeAsset, idx: number) => (
                  <div key={idx} className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4.5 space-y-3.5 relative overflow-hidden flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="bg-indigo-950/30 border border-indigo-900 text-indigo-400 font-bold px-2 py-0.5 rounded text-[8px] uppercase tracking-wider">
                          {creative.type || "creative"}
                        </span>
                        <span className="text-[8px] text-slate-500 font-mono capitalize">{creative.platform}</span>
                      </div>
                      
                      <h4 className="font-bold text-white text-xs truncate">{creative.name}</h4>
                    </div>

                    <a
                      href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand-assets/${creative.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center border border-slate-900 bg-slate-950 hover:border-slate-800 text-[10px] text-slate-400 py-2 rounded-xl transition-all font-semibold"
                    >
                      View Source File
                    </a>
                  </div>
                ))
              ) : (
                <div className="col-span-full text-center py-10 bg-slate-950/20 border border-slate-900 rounded-2xl">
                  <p className="text-xs text-slate-500 font-medium">No past creative files uploaded for this client yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Client Feedback Timeline */}
        {activeTab === "feedback" && (
          <div className="space-y-6">
            {/* Log form block */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center">
                <MessageSquare className="w-4 h-4 mr-1.5 text-indigo-400" />
                Add Client/Founder Comment
              </h3>

              <form onSubmit={handleAddFeedback} className="space-y-3.5 text-xs">
                <textarea
                  rows={3}
                  required
                  placeholder="Paste comment content (e.g. Client requested no emojis in captions, loved the gold patterns...)"
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">Sender Role:</span>
                    <button
                      type="button"
                      onClick={() => setFeedbackSender("founder")}
                      className={`py-1 px-3.5 rounded-lg border text-[10px] font-bold uppercase transition-all cursor-pointer ${
                        feedbackSender === "founder"
                          ? "bg-indigo-950/40 border-indigo-900 text-indigo-400"
                          : "border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Founder
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedbackSender("client")}
                      className={`py-1 px-3.5 rounded-lg border text-[10px] font-bold uppercase transition-all cursor-pointer ${
                        feedbackSender === "client"
                          ? "bg-indigo-950/40 border-indigo-900 text-indigo-400"
                          : "border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Client
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingFeedback}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submittingFeedback ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Log Comment</span>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Timeline Stream */}
            <div className="space-y-4 relative pl-4 border-l border-slate-900 ml-2">
              {brandBrain?.feedback_log && brandBrain.feedback_log.length > 0 ? (
                brandBrain.feedback_log.map((comment: FeedbackComment, idx: number) => (
                  <div key={idx} className="relative space-y-1.5 bg-slate-950/30 border border-slate-900/60 rounded-xl p-4">
                    {/* Glowing bullet */}
                    <div className="absolute -left-[21.5px] top-[20px] w-2.5 h-2.5 rounded-full bg-slate-950 border border-slate-800 outline outline-2 outline-indigo-500/30" />
                    
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={`font-bold flex items-center ${
                        comment.sender === "client" ? "text-indigo-400" : "text-emerald-400"
                      }`}>
                        <User className="w-3 h-3 mr-1" />
                        {comment.sender === "client" ? "Client Feedback" : "Founder Note"}
                      </span>
                      <span className="text-slate-500 font-mono">
                        {new Date(comment.date).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-medium">{comment.comment}</p>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 bg-slate-950/20 border border-slate-900 rounded-2xl -ml-4">
                  <p className="text-xs text-slate-500 font-medium">No feedback comments logged for this client yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Import Modal Dialog */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xl max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-indigo-400">
                <Upload className="w-4 h-4" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Import Client Brand Knowledge</h3>
              </div>
              <button
                onClick={() => {
                  setIsImportModalOpen(false);
                  setExtractedData(null);
                  setImportError(null);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {importError && (
              <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-xl text-red-200 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{importError}</span>
              </div>
            )}

            {/* STEP 1: Upload slot */}
            {!extractedData && !importingFile && (
              <div className="space-y-4 py-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Upload a `.txt`, `.md`, `.json`, or `.zip` file containing brand guidelines, past feedback logs, or marketing assets. 
                  We will extract key durable knowledge points for your review.
                </p>

                <label
                  className="border border-dashed border-slate-800 hover:border-indigo-500 bg-slate-950/20 hover:bg-indigo-955/5 rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center space-y-3 group"
                >
                  <input
                    type="file"
                    accept=".txt,.md,.json,.zip"
                    className="hidden"
                    onChange={handleImportFileChange}
                  />
                  <Upload className="w-8 h-8 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                  <div>
                    <p className="text-xs text-slate-300 font-semibold">Choose file or drag here</p>
                    <p className="text-[10px] text-slate-500 mt-1">Accepts TXT, MD, JSON, or ZIP (archives parsed server-side)</p>
                  </div>
                </label>
              </div>
            )}

            {/* Loader during extraction */}
            {importingFile && (
              <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-xs text-indigo-300 font-semibold animate-pulse">Analyzing Brand Document...</p>
                  <p className="text-[10px] text-slate-500">Chunking content and running MODEL_SMART extraction...</p>
                </div>
              </div>
            )}

            {/* STEP 2: Review Extracted checklist */}
            {extractedData && (
              <div className="space-y-5">
                <div className="bg-slate-950/40 border border-slate-950 p-3.5 rounded-2xl">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Import Source</span>
                  <span className="text-xs text-slate-350 font-bold block truncate mt-0.5">{uploadedFileName} ({(uploadedFileSize / 1024).toFixed(1)} KB)</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-white">Review Brand Insights before Save</h4>
                    <p className="text-[10px] text-slate-500 mt-0.5">Untick any irrelevant, incorrect, or transient items. Approved items will enter the permanent brand guidelines brain.</p>
                  </div>

                  {/* Facts Category Group */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-850 pb-1">Group 1: Brand Facts & Identity ({extractedData.facts.length})</span>
                    {extractedData.facts.length === 0 ? (
                      <p className="text-[10px] text-slate-600 italic pl-1">No durable brand facts identified.</p>
                    ) : (
                      <div className="space-y-1.5 pl-1">
                        {extractedData.facts.map((item, idx) => (
                          <label key={idx} className="flex items-start space-x-2 text-xs text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedFacts.includes(item)}
                              onChange={() => toggleFact(item)}
                              className="mt-0.5 rounded border-slate-805 focus:ring-indigo-500/20 bg-slate-950 text-indigo-650"
                            />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preferences Category Group */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-850 pb-1">Group 2: Design & Styling Preferences ({extractedData.preferences.length})</span>
                    {extractedData.preferences.length === 0 ? (
                      <p className="text-[10px] text-slate-600 italic pl-1">No styling preferences identified.</p>
                    ) : (
                      <div className="space-y-1.5 pl-1">
                        {extractedData.preferences.map((item, idx) => (
                          <label key={idx} className="flex items-start space-x-2 text-xs text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedPrefs.includes(item)}
                              onChange={() => togglePref(item)}
                              className="mt-0.5 rounded border-slate-805 focus:ring-indigo-500/20 bg-slate-950 text-indigo-650"
                            />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Learnings Category Group */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-850 pb-1">Group 3: Campaign Performance Learnings ({extractedData.learnings.length})</span>
                    {extractedData.learnings.length === 0 ? (
                      <p className="text-[10px] text-slate-600 italic pl-1">No campaign learnings identified.</p>
                    ) : (
                      <div className="space-y-1.5 pl-1">
                        {extractedData.learnings.map((item, idx) => (
                          <label key={idx} className="flex items-start space-x-2 text-xs text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedLearnings.includes(item)}
                              onChange={() => toggleLearning(item)}
                              className="mt-0.5 rounded border-slate-805 focus:ring-indigo-500/20 bg-slate-950 text-indigo-650"
                            />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Feedback Category Group */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-850 pb-1">Group 4: Client Feedback History ({extractedData.feedback.length})</span>
                    {extractedData.feedback.length === 0 ? (
                      <p className="text-[10px] text-slate-600 italic pl-1">No historical client feedback identified.</p>
                    ) : (
                      <div className="space-y-1.5 pl-1">
                        {extractedData.feedback.map((item, idx) => (
                          <label key={idx} className="flex items-start space-x-2 text-xs text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedFeedback.includes(item)}
                              onChange={() => toggleFeedback(item)}
                              className="mt-0.5 rounded border-slate-805 focus:ring-indigo-500/20 bg-slate-950 text-indigo-650"
                            />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex space-x-3 border-t border-slate-800 pt-4">
                  <button
                    onClick={() => {
                      setExtractedData(null);
                      setImportError(null);
                    }}
                    disabled={confirmingImport}
                    className="flex-1 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={confirmingImport || (selectedFacts.length === 0 && selectedPrefs.length === 0 && selectedLearnings.length === 0 && selectedFeedback.length === 0)}
                    className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white py-2.5 rounded-xl text-xs font-bold tracking-wider uppercase transition-all flex items-center justify-center space-x-2 shadow-lg shadow-indigo-950/50 cursor-pointer disabled:opacity-50"
                  >
                    {confirmingImport ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving & Synthesizing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Confirm & Sync Guidelines</span>
                      </>
                    )}
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
