"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  KanbanSquare,
  Settings,
  Loader2,
  AlertTriangle,
  User,
  Sparkles,
  Upload,
  Clock,
  X,
  Plus
} from "lucide-react";

export default function KanbanBoardPage() {
  interface ProductionTaskItem {
    id: string;
    plan_id: string;
    type: "copy" | "image" | "video";
    deadline: string;
    assignee_id: string | null;
    priority: string;
    status: string;
    draft_content: Record<string, unknown> | null;
    metadata: {
      format?: string;
      concept?: string;
      hook?: string;
      cta?: string;
      qc_corrections?: string;
      founder_feedback?: string;
      client_feedback?: string;
    } | null;
    profiles: { name: string } | null;
    monthly_plans: {
      month: string;
      clients: { id: string; name: string; products?: string[] | null } | null;
    } | null;
    creatives?: Array<{
      id: string;
      media_url: string;
      qc_status: string;
      founder_approval: string;
      client_approval: string;
    }> | null;
  }

  interface PromptTemplateItem {
    id: string;
    name: string;
    category: string;
    prompt_text: string;
    default_model: "nano_banana" | "gpt_image" | "both";
    default_ratio: string;
    sort_order: number;
    is_active: boolean;
  }

  const [tasks, setTasks] = useState<ProductionTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active drawer card
  const [selectedTask, setSelectedTask] = useState<ProductionTaskItem | null>(null);
  
  // AI draft generating state
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<Record<string, unknown> | null>(null);

  // Asset upload state
  const [mediaUrl, setMediaUrl] = useState("");
  const [captionOverride, setCaptionOverride] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Image Generation UX States
  const [selectedEngine, setSelectedEngine] = useState<"nano_banana" | "gpt_image" | "both">("nano_banana");
  const [suggestedEngine, setSuggestedEngine] = useState<"nano_banana" | "gpt_image">("nano_banana");
  const [nanoPrompt, setNanoPrompt] = useState("");
  const [gptPrompt, setGptPrompt] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImagesResult, setGeneratedImagesResult] = useState<{
    engine: "nano_banana" | "gpt_image" | "both";
    mediaUrl?: string;
    mediaUrls?: { nano_banana: string; gpt_image: string };
  } | null>(null);

  // New Prompt Template & Ratio States
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateItem[]>([]);
  const [saveTplModalOpen, setSaveTplModalOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState("");
  const [saveTplCategory, setSaveTplCategory] = useState("Product Shot");
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  interface StudioGenerationAttempt {
    id: string;
    user_id: string | null;
    task_id: string | null;
    prompt: string;
    model: string;
    ratio: string;
    reference_image_url?: string;
    higgsfield_media_ref?: string;
    generated_image_url: string;
    cost: number;
    created_at: string;
  }
  
  const [taskAttempts, setTaskAttempts] = useState<StudioGenerationAttempt[]>([]);

  const fetchTaskAttempts = async (taskId: string) => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("studio_generations")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false });

      if (!err && data) {
        setTaskAttempts(data);
      } else {
        setTaskAttempts([]);
      }
    } catch (err) {
      console.error("Failed to fetch task attempts:", err);
      setTaskAttempts([]);
    }
  };

  const nanoPromptRef = useRef<HTMLTextAreaElement>(null);
  const gptPromptRef = useRef<HTMLTextAreaElement>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data, error: err } = await supabase
        .from("tasks")
        .select(`
          *,
          profiles!tasks_assignee_id_fkey(name),
          monthly_plans!tasks_plan_id_fkey(
            month,
            clients(id, name, products)
          ),
          creatives(*)
        `)
        .order("deadline", { ascending: true });

      if (err) throw err;
      setTasks((data as unknown as ProductionTaskItem[]) || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to fetch task boards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Load templates & user session role
  useEffect(() => {
    const initTemplates = async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserRole(user?.user_metadata?.role || null);

        const res = await fetch("/api/production/templates");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.templates) {
            setPromptTemplates(data.templates.filter((t: PromptTemplateItem) => t.is_active));
          }
        }
      } catch (err) {
        console.error("Failed to load prompt templates inside production page:", err);
      }
    };
    initTemplates();
  }, []);

  // Handle task status transition
  const handleUpdateStatus = async (taskId: string, newStatus: string) => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { error: err } = await supabase
        .from("tasks")
        .update({ status: newStatus })
        .eq("id", taskId);

      if (err) throw err;

      // Update in local state
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
      if (selectedTask?.id === taskId) {
        setSelectedTask((prev) => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to move card.");
    }
  };

  // Trigger Gemini prompt first draft generator
  const handleGenerateDraft = async (taskId: string) => {
    setDrafting(true);
    setDraftResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/generate-draft`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      setDraftResult(data.draftContent);
      
      // Update local task
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, draft_content: data.draftContent } : t))
      );
      if (selectedTask?.id === taskId) {
        setSelectedTask((prev) => prev ? { ...prev, draft_content: data.draftContent } : null);
      }
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to trigger generative AI agent.");
    } finally {
      setDrafting(false);
    }
  };

  // Submit media asset upload
  const handleUploadCreative = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || !mediaUrl.trim()) return;

    setUploading(true);
    setUploadSuccess(false);
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/upload-creative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: mediaUrl,
          caption: captionOverride,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setUploadSuccess(true);
      setMediaUrl("");
      setCaptionOverride("");
      
      // Move status locally and reload tasks
      await fetchTasks();
      setSelectedTask(null);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to log creative asset.");
    } finally {
      setUploading(false);
    }
  };

  // Open task side drawer
  const openTaskDrawer = (task: ProductionTaskItem) => {
    setSelectedTask(task);
    setDraftResult(task.draft_content || null);
    setUploadSuccess(false);
    setMediaUrl("");
    setCaptionOverride("");

    // Auto-select recommended engine based on concept keywords
    const concept = task.metadata?.concept || "";
    const clientName = task.monthly_plans?.clients?.name || "Client";
    const conceptLower = concept.toLowerCase();
    
    // Heuristic routing:
    const productKeywords = ["product", "packaging", "label", "bottle", "jar", "packshot", "close-up", "pickle", "ready-to-eat", "spice", "food shot"];
    const isProductRelated = productKeywords.some(kw => conceptLower.includes(kw)) || conceptLower.includes(clientName.toLowerCase());
    const suggested = isProductRelated ? "nano_banana" : "gpt_image";
    setSuggestedEngine(suggested);
    setSelectedEngine(suggested); // Pre-select suggested engine

    // Pre-populate templates
    const colorsText = "red, saffron, teal, slate";
    const nanoTpl = `An ultra-clean, high-resolution commercial product shot of ${clientName} specialty products, placed on a warm wooden dining table with raw spices scattering in background. Focus on composition and packaging label. Colors: ${colorsText}. Concept: "${concept}".`;
    const gptTpl = `A highly stylized, illustrative and artistic creative post showing an abstract collage of ${concept} in traditional Indian style. Cinematic lighting, rich modern color grading with ${colorsText} accents.`;

    setNanoPrompt(nanoTpl);
    setGptPrompt(gptTpl);
    setGeneratedImagesResult(null);
    fetchTaskAttempts(task.id);
  };

  // Apply prompt template and auto-replace placeholder keys
  const applyPromptTemplate = (template: PromptTemplateItem) => {
    if (!selectedTask) return;

    const brandName = selectedTask.monthly_plans?.clients?.name || "SWAD";
    let productName = "specialty products";

    const productsList = selectedTask.monthly_plans?.clients?.products;
    if (productsList && Array.isArray(productsList) && productsList.length > 0) {
      productName = productsList[0];
    }

    // Replace {brand} and {product}
    const filledText = template.prompt_text
      .replace(/{brand}/g, brandName)
      .replace(/{product}/g, productName);

    setSelectedEngine(template.default_model);
    setSelectedRatio(template.default_ratio);

    if (template.default_model === "nano_banana") {
      setNanoPrompt(filledText);
      selectFirstPlaceholder(filledText, nanoPromptRef.current);
    } else if (template.default_model === "gpt_image") {
      setGptPrompt(filledText);
      selectFirstPlaceholder(filledText, gptPromptRef.current);
    } else {
      setNanoPrompt(filledText);
      setGptPrompt(filledText);
      selectFirstPlaceholder(filledText, nanoPromptRef.current);
    }
  };

  const selectFirstPlaceholder = (text: string, textareaEl: HTMLTextAreaElement | null) => {
    if (!textareaEl) return;
    const match = text.match(/{[a-zA-Z0-9_-]+}/);
    if (match && typeof match.index === "number") {
      const start = match.index;
      const end = start + match[0].length;
      setTimeout(() => {
        textareaEl.focus();
        textareaEl.setSelectionRange(start, end);
      }, 50);
    }
  };

  const handleSaveAsTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveTplName.trim()) {
      alert("Please specify a template name.");
      return;
    }

    try {
      const activePrompt = selectedEngine === "gpt_image" ? gptPrompt : nanoPrompt;
      const payload = {
        name: saveTplName,
        category: saveTplCategory,
        prompt_text: activePrompt,
        default_model: selectedEngine === "both" ? "nano_banana" : selectedEngine,
        default_ratio: selectedRatio,
      };

      const res = await fetch("/api/production/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save template");
      }

      alert(data.message || `Template "${saveTplName}" saved successfully!`);
      setSaveTplModalOpen(false);
      setSaveTplName("");

      // Reload templates list
      const templatesRes = await fetch("/api/production/templates");
      if (templatesRes.ok) {
        const tplData = await templatesRes.json();
        if (tplData.success && tplData.templates) {
          setPromptTemplates(tplData.templates.filter((t: PromptTemplateItem) => t.is_active));
        }
      }
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to save template.");
    }
  };

  // Image Generation triggers
  const handleGenerateImage = async () => {
    if (!selectedTask) return;
    setIsGeneratingImage(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: selectedEngine,
          prompts: {
            nano_banana: nanoPrompt,
            gpt_image: gptPrompt,
          },
          ratio: selectedRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image generation failed");
      
      setGeneratedImagesResult(data);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate image.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleSelectGeneratedImage = async (url: string, engineUsed: "nano_banana" | "gpt_image") => {
    if (!selectedTask) return;
    setUploading(true);
    setUploadSuccess(false);
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/upload-creative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: url,
          caption: `Generated using ${engineUsed === "nano_banana" ? "Nano Banana" : "GPT Image"} engine.`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setUploadSuccess(true);
      
      // Move status locally and reload tasks
      await fetchTasks();
      setSelectedTask(null);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to log creative asset.");
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    { key: "todo", title: "To Do", bg: "border-slate-800 bg-slate-900/10 text-slate-400" },
    { key: "in_progress", title: "In Progress", bg: "border-indigo-900/30 bg-indigo-950/5 text-indigo-400" },
    { key: "review", title: "Review", bg: "border-amber-900/30 bg-amber-950/5 text-amber-400" },
    { key: "done", title: "Completed", bg: "border-emerald-900/30 bg-emerald-950/5 text-emerald-400" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 relative">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
            <KanbanSquare className="w-4 h-4" />
            <span>Creative Operations</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-sans">Task Production Board</h1>
          <p className="text-slate-400 text-xs mt-1">Organize calendar outputs, draft prompts, and log creative renders.</p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => {
              // Simulate overdue check trigger
              fetch("/api/cron/overdue-digest");
              alert("Overdue digest cron job triggered in background!");
            }}
            className="flex items-center justify-center space-x-1.5 border border-amber-900/40 hover:border-amber-800 bg-amber-950/10 text-amber-400 py-2 px-4 rounded-xl text-xs font-semibold"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Trigger Overdue Digest</span>
          </button>
          
          <Link
            href="/dashboard/production/settings"
            className="flex items-center justify-center space-x-1.5 border border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-300 py-2 px-4 rounded-xl text-xs font-semibold"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure Assignees</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-2">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <span className="text-[10px] text-slate-500 font-medium">Synchronizing Kanban Board...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            
            return (
              <div key={col.key} className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4.5 space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-slate-900">
                  <span className="text-xs font-bold text-slate-200">{col.title}</span>
                  <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <div className="space-y-3 min-h-[300px] max-h-[600px] overflow-y-auto pr-1">
                  {colTasks.length === 0 ? (
                    <div className="h-[100px] border border-dashed border-slate-900/60 rounded-xl flex items-center justify-center text-center p-3">
                      <span className="text-[10px] text-slate-600">No cards</span>
                    </div>
                  ) : (
                    colTasks.map((t) => {
                      const clientName = t.monthly_plans?.clients?.name || "Agency Project";
                      const overdue = new Date(t.deadline) < new Date() && t.status !== "done";
                      
                      return (
                        <div
                          key={t.id}
                          onClick={() => openTaskDrawer(t)}
                          className="bg-slate-900/30 border border-slate-900 hover:border-slate-800 transition-all rounded-xl p-3.5 space-y-3 cursor-pointer text-left relative"
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-[10px] text-slate-300 font-bold tracking-tight">{clientName}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              t.type === "video"
                                ? "bg-purple-950/40 border border-purple-900 text-purple-400"
                                : t.type === "image"
                                ? "bg-indigo-950/40 border border-indigo-900 text-indigo-400"
                                : "bg-emerald-950/40 border border-emerald-800 text-emerald-400"
                            }`}>
                              {t.type}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-normal line-clamp-2 italic">
                            &ldquo;{t.metadata?.concept || "Production Task"}&rdquo;
                          </p>

                          <div className="flex justify-between items-center text-[9px] pt-1.5 border-t border-slate-900/40">
                            <span className="text-slate-500 font-medium flex items-center space-x-1">
                              <User className="w-3 h-3 text-slate-600" />
                              <span>{t.profiles?.name || "Unassigned"}</span>
                            </span>

                            <span className={`font-mono font-semibold flex items-center space-x-1 ${
                              overdue ? "text-red-400 font-bold" : "text-slate-500"
                            }`}>
                              {overdue && <AlertTriangle className="w-3 h-3 text-red-500" />}
                              <span>{new Date(t.deadline).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Side drawer detailed view */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-end transition-opacity duration-350">
          <div className="w-full max-w-lg bg-slate-950 border-l border-slate-950 h-screen flex flex-col p-6 space-y-6 overflow-y-auto text-xs">
            
            {/* Drawer Header */}
            <div className="flex justify-between items-start border-b border-slate-900 pb-4">
              <div>
                <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-mono font-bold block mb-1">
                  {selectedTask.type} production task
                </span>
                <h3 className="text-base font-extrabold text-white font-sans">
                  {selectedTask.monthly_plans?.clients?.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="p-1.5 border border-slate-800 rounded-xl hover:border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Status Adjustments */}
            <div className="space-y-2">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Task Status</span>
              <div className="flex flex-wrap gap-2">
                {columns.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => handleUpdateStatus(selectedTask.id, c.key)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer ${
                      selectedTask.status === c.key
                        ? "bg-indigo-600 border-indigo-500 text-white font-bold"
                        : "border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Task Concept Context */}
            <div className="bg-slate-900/25 border border-slate-900 rounded-xl p-4 space-y-2">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Post Concept Description</span>
              <p className="text-[11px] text-slate-300 leading-relaxed italic">
                &ldquo;{selectedTask.metadata?.concept || "No description provided."}&rdquo;
              </p>
              {selectedTask.metadata?.hook && (
                <div className="pt-2 text-[10px] text-slate-400">
                  <strong>Hook:</strong> {selectedTask.metadata.hook}
                </div>
              )}
              {selectedTask.metadata?.cta && (
                <div className="text-[10px] text-slate-400">
                  <strong>CTA:</strong> {selectedTask.metadata.cta}
                </div>
              )}
            </div>

            {/* AI Generator Panel */}
            <div className="bg-slate-950 border border-slate-900 rounded-2xl p-5 space-y-4">
              {selectedTask.type === "image" ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-white mb-0.5 font-sans">Higgsfield Image Studio</h4>
                    <p className="text-[9px] text-slate-500 font-medium">Use the dedicated studio workstation to generate assets for this task.</p>
                  </div>

                  <Link
                    href={`/dashboard/image-studio?taskId=${encodeURIComponent(selectedTask.id)}&clientId=${encodeURIComponent(selectedTask.monthly_plans?.clients?.id || "")}&clientName=${encodeURIComponent(selectedTask.monthly_plans?.clients?.name || "")}&taskName=${encodeURIComponent(selectedTask.metadata?.concept || "Image Generation")}&plannedDate=${encodeURIComponent(selectedTask.deadline || "")}&prompt=${encodeURIComponent((selectedTask.draft_content?.image_prompt as string) || selectedTask.metadata?.concept || "")}&suggestedModel=${encodeURIComponent(suggestedEngine === "nano_banana" ? "Nano Banana 2" : "Nano Banana Pro")}&ratio=${encodeURIComponent(selectedRatio || "1:1")}`}
                    className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-indigo-950/50 cursor-pointer text-center"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Open in Image Studio</span>
                  </Link>

                  <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-3.5 space-y-2.5 text-[10px] text-slate-400">
                    <div className="font-bold text-slate-300 border-b border-slate-800 pb-1.5 uppercase tracking-wide text-[9px]">Pre-filled Parameters</div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Suggested Model:</span>
                      <span className="text-slate-300 font-semibold">{suggestedEngine === "nano_banana" ? "Nano Banana 2" : "Nano Banana Pro"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Preset Ratio:</span>
                      <span className="text-slate-300 font-semibold">{selectedRatio || "1:1"}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-slate-500 block">Task Concept Prompt:</span>
                      <span className="text-slate-300 italic block line-clamp-3 bg-slate-950/50 p-2 rounded border border-slate-850">
                        {(selectedTask.draft_content?.image_prompt as string) || selectedTask.metadata?.concept || "No prompt pre-filled"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Copy or Video task details flow */
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white mb-0.5">AI Generative Assistant</h4>
                      <p className="text-[9px] text-slate-500">Draft script boards, colors, and render prompts</p>
                    </div>
                    <button
                      onClick={() => handleGenerateDraft(selectedTask.id)}
                      disabled={drafting}
                      className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white py-1 px-3 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      {drafting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{draftResult ? "Re-generate" : "Generate Draft"}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {draftResult ? (
                    <div className="border-t border-slate-900 pt-4 space-y-3.5 text-[11px] text-slate-300 leading-relaxed max-h-[300px] overflow-y-auto pr-1">
                      {(() => {
                        const draftCopy = draftResult as Record<string, unknown>;
                        return (
                          <>
                            {selectedTask.type === "copy" && (
                              <div className="space-y-3">
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Headline</strong>
                                  <p className="text-white font-medium">{draftCopy.headline as string}</p>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Caption body</strong>
                                  <p>{draftCopy.caption as string}</p>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">CTA</strong>
                                  <p className="text-indigo-400">{draftCopy.cta as string}</p>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Hashtags</strong>
                                  <p className="text-slate-500">{(draftCopy.hashtags as string[])?.join(" ")}</p>
                                </div>
                                {!!(draftCopy.reel_script as string) && (
                                  <div>
                                    <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Reel Video Script</strong>
                                    <p className="bg-slate-900 border border-slate-850 p-2.5 rounded-lg whitespace-pre-line font-sans italic">{draftCopy.reel_script as string}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {selectedTask.type === "video" && (
                              <div className="space-y-3">
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Reel Concept</strong>
                                  <p>{draftCopy.reel_concept as string}</p>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Voiceover Script</strong>
                                  <p className="italic font-medium">&ldquo;{draftCopy.voiceover_script as string}&rdquo;</p>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Shot list Breakdown</strong>
                                  <ul className="list-disc pl-4 space-y-1">
                                    {(draftCopy.shot_list as string[])?.map((s: string, idx: number) => (
                                      <li key={idx}>{s}</li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <strong className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Seedance Prompt</strong>
                                  <p className="bg-slate-900 border border-slate-850 p-2.5 rounded-lg font-mono text-[10px] break-words">{draftCopy.video_prompt as string}</p>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-slate-600 text-[10px] italic">
                      No draft generated yet. Click generate to feed guidelines to the LLM agent.
                    </div>
                  )}
                </>
              )}
            </div>

            {taskAttempts && taskAttempts.length > 0 && (
              <div className="bg-slate-950 border border-slate-900 rounded-2xl p-5 space-y-3">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                  Higgsfield Studio Attempts ({taskAttempts.length})
                </span>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {taskAttempts.map((attempt) => (
                    <div key={attempt.id} className="bg-slate-900/30 border border-slate-900 rounded-xl overflow-hidden flex flex-col">
                      <div className="relative aspect-video w-full bg-slate-950">
                        <img src={attempt.generated_image_url} alt={attempt.prompt} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-2 space-y-1">
                        <span className="text-[8px] font-bold text-slate-400 block truncate" title={attempt.prompt}>
                          {attempt.prompt}
                        </span>
                        <span className="text-[7px] text-slate-500 block uppercase font-bold">
                          {attempt.model} ({attempt.ratio})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedTask.creatives && selectedTask.creatives.length > 0 && (
              <div className="bg-slate-950 border border-slate-900 rounded-2xl p-5 space-y-3">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Uploaded Creative Drafts</span>
                <div className="space-y-2">
                  {selectedTask.creatives.map((c) => (
                    <div key={c.id} className="flex justify-between items-center bg-slate-900/30 border border-slate-900 p-3 rounded-xl text-[10px]">
                      <div className="space-y-1">
                        <a href={c.media_url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-400 hover:underline block truncate max-w-[200px]">
                          {c.media_url}
                        </a>
                        <span className="text-[8px] text-slate-500 block">QC: {c.qc_status} | Founder: {c.founder_approval} | Client: {c.client_approval}</span>
                      </div>
                      <Link
                        href={`/dashboard/creatives/${c.id}/timeline`}
                        className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded"
                      >
                        View Timeline
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Creative asset upload block */}
            {selectedTask.status !== "done" && (
              <form onSubmit={handleUploadCreative} className="bg-slate-950 border border-slate-900 rounded-2xl p-5 space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-white mb-0.5">Upload Finished Creative</h4>
                  <p className="text-[9px] text-slate-500 font-sans">Submit final media URL to transition task into review</p>
                </div>

                {uploadSuccess && (
                  <div className="p-3 bg-emerald-950/20 border border-emerald-900 text-emerald-300 rounded-xl text-[10px]">
                    Creative uploaded successfully! Task moved to review.
                  </div>
                )}

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Creative Media URL</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. https://storage.supabase.com/creatives/render.jpg"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Optional Caption Override</label>
                    <input
                      type="text"
                      placeholder="Custom caption text override"
                      value={captionOverride}
                      onChange={(e) => setCaptionOverride(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={uploading || !mediaUrl.trim()}
                  className="w-full flex items-center justify-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2 rounded-xl text-[10px] cursor-pointer"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>Log creative & Move to Review</span>
                    </>
                  )}
                </button>
              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
