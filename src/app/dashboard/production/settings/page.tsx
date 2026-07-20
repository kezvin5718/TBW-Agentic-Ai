"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Settings,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles
} from "lucide-react";

interface UserProfileListItem {
  id: string;
  name: string;
  role: string;
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

export default function ProductionSettingsPage() {
  // Tabs: assignees (all), templates (founder-only)
  const [activeTab, setActiveTab] = useState<"assignees" | "templates">("assignees");
  const [userRole, setUserRole] = useState<string | null>(null);

  // Assignee states
  const [profiles, setProfiles] = useState<UserProfileListItem[]>([]);
  const [defaultAssignees, setDefaultAssignees] = useState<Record<string, string | null>>({
    copy: null,
    image: null,
    video: null,
  });
  
  // Template states
  const [templates, setTemplates] = useState<PromptTemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  
  // Loader & Alert states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states for Prompt Template CRUD
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplateItem | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState("Product Shot");
  const [tplPromptText, setTplPromptText] = useState("");
  const [tplDefaultModel, setTplDefaultModel] = useState<"nano_banana" | "gpt_image" | "both">("nano_banana");
  const [tplDefaultRatio, setTplDefaultRatio] = useState("1:1");
  const [tplIsActive, setTplIsActive] = useState(true);

  // Categories helper
  const categoriesList = ["Product Shot", "Lifestyle", "Festive", "UGC Style", "Creative", "Seasonal"];
  const ratioList = ["1:1", "9:16", "16:9", "4:5"];

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const role = user?.user_metadata?.role || null;
        setUserRole(role);

        // Fetch assignee mappings
        const res = await fetch("/api/production/settings");
        if (!res.ok) throw new Error("Failed to load production settings");
        const data = await res.json();
        
        setDefaultAssignees(data.defaultAssignees);
        setProfiles(data.profiles || []);

        // Fetch prompt templates if user is founder
        if (role === "founder") {
          await fetchTemplates();
        }
      } catch (err: unknown) {
        console.error(err);
        setError("Could not load production configuration.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const fetchTemplates = async () => {
    try {
      setTemplatesLoading(true);
      const res = await fetch("/api/production/templates");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.templates) {
          setTemplates(data.templates);
        }
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSaveAssignees = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/production/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultAssignees }),
      });

      if (!res.ok) throw new Error("Failed to save assignee settings");
      setSuccess("Default assignee mappings saved successfully.");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to update configurations.");
    } finally {
      setSaving(false);
    }
  };

  const handleAssigneeChange = (type: string, userId: string) => {
    setDefaultAssignees((prev) => ({
      ...prev,
      [type]: userId || null,
    }));
  };

  // Open Add/Edit Template form
  const openForm = (tpl?: PromptTemplateItem) => {
    setError(null);
    setSuccess(null);
    if (tpl) {
      setEditingTemplate(tpl);
      setTplName(tpl.name);
      setTplCategory(tpl.category);
      setTplPromptText(tpl.prompt_text);
      setTplDefaultModel(tpl.default_model);
      setTplDefaultRatio(tpl.default_ratio);
      setTplIsActive(tpl.is_active);
    } else {
      setEditingTemplate(null);
      setTplName("");
      setTplCategory("Product Shot");
      setTplPromptText("");
      setTplDefaultModel("nano_banana");
      setTplDefaultRatio("1:1");
      setTplIsActive(true);
    }
    setIsFormOpen(true);
  };

  // Submit Template form (Add/Edit)
  const handleSubmitTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim() || !tplPromptText.trim()) {
      setError("Please fill in template name and prompt content.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        id: editingTemplate?.id,
        name: tplName,
        category: tplCategory,
        prompt_text: tplPromptText,
        default_model: tplDefaultModel,
        default_ratio: tplDefaultRatio,
        is_active: tplIsActive
      };

      const method = editingTemplate ? "PUT" : "POST";
      const res = await fetch("/api/production/templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save template.");
      }

      setSuccess(`Template "${tplName}" saved successfully.`);
      setIsFormOpen(false);
      await fetchTemplates();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // Reorder template (Up/Down arrow shifts sort_order)
  const handleMoveTemplate = async (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === templates.length - 1) return;

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    const currentTpl = templates[index];
    const swapTpl = templates[swapIndex];

    // Local state swap for quick feedback
    const reordered = [...templates];
    reordered[index] = { ...swapTpl, sort_order: currentTpl.sort_order };
    reordered[swapIndex] = { ...currentTpl, sort_order: swapTpl.sort_order };
    setTemplates(reordered);

    try {
      // Update database orders
      await fetch("/api/production/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentTpl.id, sort_order: swapTpl.sort_order }),
      });
      await fetch("/api/production/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: swapTpl.id, sort_order: currentTpl.sort_order }),
      });
    } catch (err) {
      console.error("Failed to persist order shift in database:", err);
      // Revert if error
      await fetchTemplates();
    }
  };

  // Toggle template active status
  const handleToggleActive = async (tpl: PromptTemplateItem) => {
    try {
      const res = await fetch("/api/production/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tpl.id, is_active: !tpl.is_active }),
      });
      if (res.ok) {
        await fetchTemplates();
      }
    } catch (err) {
      console.error("Failed to toggle template status:", err);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/production/templates?id=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete template");
      setSuccess("Template deleted successfully.");
      await fetchTemplates();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Deletion failed.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Navigation */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/dashboard/production"
            className="p-2 border border-slate-800 rounded-xl hover:border-slate-700 bg-slate-950/20 text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-1 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
              <Settings className="w-3.5 h-3.5" />
              <span>Production Settings</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Studio Configuration</h1>
          </div>
        </div>
      </div>

      {/* Tabs list (templates is founder-only) */}
      <div className="flex space-x-2 border-b border-slate-900 pb-1">
        <button
          onClick={() => setActiveTab("assignees")}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer ${
            activeTab === "assignees"
              ? "text-white border-b-2 border-indigo-500 bg-indigo-500/5"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Assignee Mappings
        </button>
        {userRole === "founder" && (
          <button
            onClick={() => setActiveTab("templates")}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer ${
              activeTab === "templates"
                ? "text-white border-b-2 border-indigo-500 bg-indigo-500/5"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Prompt Templates
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/50 text-emerald-200 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      ) : activeTab === "assignees" ? (
        /* ASSIGNEES MAPPINGS FORM */
        <form onSubmit={handleSaveAssignees} className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">Default Task Assignees</h3>
            <p className="text-[10px] text-slate-500">Configure default team members responsible for new plan calendar tasks.</p>
          </div>

          <div className="space-y-4.5 text-xs">
            {/* Copy Task Assignee */}
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Default Copywriter (Caption & Scripts)</label>
              <select
                value={defaultAssignees.copy || ""}
                onChange={(e) => handleAssigneeChange("copy", e.target.value)}
                className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
              >
                <option value="">-- Unassigned --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            </div>

            {/* Image Task Assignee */}
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Default Graphic Designer (Images & Carousels)</label>
              <select
                value={defaultAssignees.image || ""}
                onChange={(e) => handleAssigneeChange("image", e.target.value)}
                className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
              >
                <option value="">-- Unassigned --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            </div>

            {/* Video Task Assignee */}
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Default Video Editor (Reels & Storyboards)</label>
              <select
                value={defaultAssignees.video || ""}
                onChange={(e) => handleAssigneeChange("video", e.target.value)}
                className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
              >
                <option value="">-- Unassigned --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer shadow-md"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span>Save Mappings</span>
            )}
          </button>
        </form>
      ) : (
        /* PROMPT TEMPLATES MANAGER (FOUNDER ONLY) */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Prompt Templates Library</span>
              </h3>
              <p className="text-[10px] text-slate-500">Add, edit, reorder, or deactivate prompt templates for Image Studio.</p>
            </div>
            <button
              onClick={() => openForm()}
              className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Template</span>
            </button>
          </div>

          {/* Form Modal / Panel */}
          {isFormOpen && (
            <form onSubmit={handleSubmitTemplate} className="bg-slate-950/60 border border-indigo-500/20 rounded-2xl p-5 space-y-4 text-xs">
              <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
                <h4 className="font-bold text-white text-xs">{editingTemplate ? "Edit Template" : "Add Prompt Template"}</h4>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="text-slate-500 hover:text-slate-300 font-bold"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Template Name</label>
                  <input
                    type="text"
                    required
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="e.g. Dreamy Portrait"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
                  <select
                    value={tplCategory}
                    onChange={(e) => setTplCategory(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    {categoriesList.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Prompt Text (Use {`{product}`} and {`{brand}`} placeholders)</label>
                <textarea
                  required
                  rows={3}
                  value={tplPromptText}
                  onChange={(e) => setTplPromptText(e.target.value)}
                  placeholder="e.g. A high-quality photo of {product} on an elegant marble table..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Default Model</label>
                  <select
                    value={tplDefaultModel}
                    onChange={(e) => setTplDefaultModel(e.target.value as "nano_banana" | "gpt_image" | "both")}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    <option value="nano_banana">Nano Banana</option>
                    <option value="gpt_image">GPT Image</option>
                    <option value="both">Both (Compare)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Default Ratio</label>
                  <select
                    value={tplDefaultRatio}
                    onChange={(e) => setTplDefaultRatio(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    {ratioList.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-2 pt-5">
                  <input
                    type="checkbox"
                    id="tplIsActive"
                    checked={tplIsActive}
                    onChange={(e) => setTplIsActive(e.target.checked)}
                    className="rounded border-slate-850 bg-slate-900 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="tplIsActive" className="font-bold text-slate-300 cursor-pointer">
                    Active & Available
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer shadow-md"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Save Template</span>}
              </button>
            </form>
          )}

          {/* Templates List Table */}
          {templatesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-10 text-slate-500 bg-slate-950/10 border border-slate-900 rounded-2xl">
              No prompt templates created. Seed default templates or click &quot;Add Template&quot; above.
            </div>
          ) : (
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900/60 text-[9px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-900">
                    <tr>
                      <th className="py-3 px-4">Order</th>
                      <th className="py-3 px-4">Template</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Default Config</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/40">
                    {templates.map((tpl, idx) => (
                      <tr key={tpl.id} className="hover:bg-slate-900/10 transition-colors">
                        {/* Sort Order cyclers */}
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleMoveTemplate(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveTemplate(idx, "down")}
                              disabled={idx === templates.length - 1}
                              className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        {/* Name & Prompt Text */}
                        <td className="py-3 px-4 max-w-xs">
                          <span className="font-bold text-white block mb-0.5">{tpl.name}</span>
                          <span className="text-[10px] text-slate-400 line-clamp-1 italic">{tpl.prompt_text}</span>
                        </td>

                        {/* Category */}
                        <td className="py-3 px-4">
                          <span className="bg-slate-900/60 border border-slate-800 px-2 py-0.5 rounded text-[10px] font-medium text-slate-300">
                            {tpl.category}
                          </span>
                        </td>

                        {/* Defaults */}
                        <td className="py-3 px-4">
                          <div className="space-y-0.5 text-[10px] font-mono text-slate-400">
                            <div className="capitalize">Model: {tpl.default_model.replace("_", " ")}</div>
                            <div>Ratio: {tpl.default_ratio}</div>
                          </div>
                        </td>

                        {/* Active state */}
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(tpl)}
                            className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide cursor-pointer ${
                              tpl.is_active
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-red-500/10 text-red-400 border border-red-500/20"
                            }`}
                          >
                            {tpl.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>

                        {/* Action buttons */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              type="button"
                              onClick={() => openForm(tpl)}
                              className="p-1.5 border border-slate-850 hover:border-slate-700 bg-slate-900/40 text-slate-400 hover:text-white rounded-lg cursor-pointer transition-colors"
                              title="Edit Template"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(tpl.id)}
                              className="p-1.5 border border-red-950/40 hover:border-red-900 bg-red-950/10 text-red-400 hover:text-red-300 rounded-lg cursor-pointer transition-colors"
                              title="Delete Template"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
