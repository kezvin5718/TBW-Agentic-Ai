"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Filter,
  CheckCircle2,
  Sparkles,
  Loader2,
  Lock,
  X
} from "lucide-react";

interface AgencyBrainEntry {
  id: string;
  category: "creative_patterns" | "performance_benchmarks" | "platform_learnings" | "prompt_patterns" | "process_rules";
  content: string;
  confidence: "observed_once" | "recurring" | "proven";
  source_count: number;
  updated_at: string;
}

export default function AgencyBrainPage() {
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(true);
  const [isFounder, setIsFounder] = useState(false);
  const [entries, setEntries] = useState<AgencyBrainEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedConfidence, setSelectedConfidence] = useState<string>("all");

  // Form Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AgencyBrainEntry | null>(null);

  // Form Fields
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<AgencyBrainEntry["category"]>("creative_patterns");
  const [formConfidence, setFormConfidence] = useState<AgencyBrainEntry["confidence"]>("observed_once");
  const [formSourceCount, setFormSourceCount] = useState(1);
  const [saving, setSaving] = useState(false);

  // 1. Verify User Role
  const checkRoleAndFetch = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Unauthorized");
        setLoading(false);
        return;
      }

      const role = user.user_metadata?.role;
      if (role !== "founder") {
        setIsFounder(false);
        setLoading(false);
        return;
      }

      setIsFounder(true);
      await fetchEntries();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Authentication error occurred");
      setLoading(false);
    }
  };

  // 2. Fetch Entries
  const fetchEntries = async () => {
    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("agency_brain")
        .select("*")
        .order("source_count", { ascending: false });

      if (fetchErr) throw fetchErr;
      setEntries(data || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load agency brain entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkRoleAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Add Entry Handler
  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formContent.trim()) return;

    setSaving(true);
    try {
      const { error: insErr } = await supabase
        .from("agency_brain")
        .insert({
          category: formCategory,
          content: formContent.trim(),
          confidence: formConfidence,
          source_count: Number(formSourceCount) || 1,
          updated_at: new Date().toISOString()
        });

      if (insErr) throw insErr;

      setIsAddModalOpen(false);
      setFormContent("");
      setFormCategory("creative_patterns");
      setFormConfidence("observed_once");
      setFormSourceCount(1);

      await fetchEntries();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 4. Edit Entry Handler
  const handleEditEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || !formContent.trim()) return;

    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from("agency_brain")
        .update({
          category: formCategory,
          content: formContent.trim(),
          confidence: formConfidence,
          source_count: Number(formSourceCount) || 1,
          updated_at: new Date().toISOString()
        })
        .eq("id", editingEntry.id);

      if (upErr) throw upErr;

      setIsEditModalOpen(false);
      setEditingEntry(null);
      setFormContent("");

      await fetchEntries();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 5. Delete Entry Handler
  const handleDeleteEntry = async (id: string) => {
    if (!confirm("Are you sure you want to delete this agency pattern learning?")) return;

    try {
      const { error: delErr } = await supabase
        .from("agency_brain")
        .delete()
        .eq("id", id);

      if (delErr) throw delErr;
      await fetchEntries();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const openEditModal = (entry: AgencyBrainEntry) => {
    setEditingEntry(entry);
    setFormContent(entry.content);
    setFormCategory(entry.category);
    setFormConfidence(entry.confidence);
    setFormSourceCount(entry.source_count);
    setIsEditModalOpen(true);
  };

  // Filtered List
  const filteredEntries = entries.filter((e) => {
    const matchesCat = selectedCategory === "all" || e.category === selectedCategory;
    const matchesConf = selectedConfidence === "all" || e.confidence === selectedConfidence;
    return matchesCat && matchesConf;
  });

  // Confidence Styles Helper
  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "proven":
        return "bg-amber-950/40 border-amber-900 text-amber-300 shadow-amber-950/20";
      case "recurring":
        return "bg-sky-950/40 border-sky-900 text-sky-300 shadow-sky-950/20";
      default:
        return "bg-purple-950/30 border-purple-900/60 text-purple-300";
    }
  };

  // Category Translation Helper
  const translateCategory = (cat: string) => {
    return cat.replace("_", " ").toUpperCase();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        <span className="text-xs text-indigo-300 font-medium animate-pulse">Accessing Agency Brain...</span>
      </div>
    );
  }

  if (!isFounder) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 px-4 text-center">
        <div className="p-4 bg-red-950/20 border border-red-900/60 rounded-3xl text-red-300 w-16 h-16 flex items-center justify-center shadow-lg">
          <Lock className="w-6 h-6 text-red-400" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Access Restricted</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            The Agency Brain contains cross-brand campaign insights, generalizable patterns, and private optimization models. Access is strictly limited to TBW Founders.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 md:px-6 py-2">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-900 pb-5">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400">
            <Layers className="w-5 h-5" />
            <h1 className="text-base font-bold text-white uppercase tracking-wider">Agency Brain</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Central shared knowledge base for generalized, completely anonymized creative rules, benchmarks, and platform algorithms. Feeds strategy, budget, and draft generators.
          </p>
        </div>

        <button
          onClick={() => {
            setFormContent("");
            setFormCategory("creative_patterns");
            setFormConfidence("observed_once");
            setFormSourceCount(1);
            setIsAddModalOpen(true);
          }}
          className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold uppercase tracking-wider py-2.5 px-4 rounded-xl transition-all shadow-lg shadow-indigo-950/40 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Learning</span>
        </button>
      </div>

      {/* Filters Control Panel */}
      <div className="bg-slate-950/40 border border-slate-900 p-4 rounded-2xl flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">Filter category:</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "all", label: "All Category" },
              { id: "creative_patterns", label: "Creative" },
              { id: "performance_benchmarks", label: "Benchmarks" },
              { id: "platform_learnings", label: "Platform" },
              { id: "prompt_patterns", label: "Prompts" },
              { id: "process_rules", label: "Process" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  selectedCategory === tab.id
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Confidence:</span>
          <select
            value={selectedConfidence}
            onChange={(e) => setSelectedConfidence(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg text-[10px] py-1.5 px-2.5 text-slate-300 font-bold focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Levels</option>
            <option value="proven">Proven (5+ sources)</option>
            <option value="recurring">Recurring (2+ sources)</option>
            <option value="observed_once">Observed Once</option>
          </select>
        </div>
      </div>

      {/* Listings grid */}
      {filteredEntries.length === 0 ? (
        <div className="py-16 text-center bg-slate-950/20 border border-slate-900/60 rounded-3xl space-y-2">
          <Layers className="w-8 h-8 text-slate-650 mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">No general patterns found matching current filters.</p>
          <p className="text-[10px] text-slate-600">The weekly learning loop cron aggregates patterns automatically from metrics data.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredEntries.map((item) => (
            <div
              key={item.id}
              className={`bg-slate-950/30 border rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all duration-350 hover:bg-slate-950/50 hover:border-slate-850 group ${
                item.confidence === "proven" ? "border-amber-900/40 hover:border-amber-900/80" : "border-slate-900"
              }`}
            >
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-850 text-[9px] font-extrabold tracking-wider font-mono text-slate-350">
                    {translateCategory(item.category)}
                  </span>
                  
                  <div className={`px-2 py-0.5 rounded-md border text-[9px] font-extrabold flex items-center space-x-1 uppercase ${getConfidenceBadge(item.confidence)}`}>
                    {item.confidence === "proven" && <Sparkles className="w-2.5 h-2.5 mr-0.5" />}
                    <span>{item.confidence.replace("_", " ")}</span>
                  </div>

                  <span className="text-[9px] text-slate-500 font-bold uppercase font-mono">
                    Sources: {item.source_count}
                  </span>
                </div>

                <p className="text-xs text-slate-200 leading-relaxed font-medium">{item.content}</p>
              </div>

              <div className="flex items-center space-x-2 shrink-0 self-end md:self-center opacity-70 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEditModal(item)}
                  className="p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteEntry(item.id)}
                  className="p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddEntry}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center">
                <Plus className="w-4 h-4 mr-1.5 text-indigo-400" />
                Add New General Learning Entry
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Category */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="creative_patterns">Creative Patterns</option>
                  <option value="performance_benchmarks">Performance Benchmarks</option>
                  <option value="platform_learnings">Platform Learnings</option>
                  <option value="prompt_patterns">Prompt Patterns</option>
                  <option value="process_rules">Process Rules</option>
                </select>
              </div>

              {/* Confidence */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Confidence Level</label>
                  <select
                    value={formConfidence}
                    onChange={(e) => setFormConfidence(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="observed_once">Observed Once</option>
                    <option value="recurring">Recurring (2+)</option>
                    <option value="proven">Proven (5+)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Source Count (Observations)</label>
                  <input
                    type="number"
                    min={1}
                    value={formSourceCount}
                    onChange={(e) => setFormSourceCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Learning Content */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Anonymized Pattern / Learning Description</label>
                <textarea
                  rows={4}
                  required
                  placeholder="e.g. Question-hook reels outperform direct value statements by 30% CTR in organic food categories. Avoid mentioning specific client names."
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3.5 text-xs text-white placeholder-slate-650 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !formContent.trim()}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Add to shared brain</span>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleEditEntry}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center">
                <Edit2 className="w-4 h-4 mr-1.5 text-indigo-400" />
                Modify Learning Entry
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingEntry(null);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Category */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="creative_patterns">Creative Patterns</option>
                  <option value="performance_benchmarks">Performance Benchmarks</option>
                  <option value="platform_learnings">Platform Learnings</option>
                  <option value="prompt_patterns">Prompt Patterns</option>
                  <option value="process_rules">Process Rules</option>
                </select>
              </div>

              {/* Confidence */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Confidence Level</label>
                  <select
                    value={formConfidence}
                    onChange={(e) => setFormConfidence(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="observed_once">Observed Once</option>
                    <option value="recurring">Recurring (2+)</option>
                    <option value="proven">Proven (5+)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Source Count (Observations)</label>
                  <input
                    type="number"
                    min={1}
                    value={formSourceCount}
                    onChange={(e) => setFormSourceCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Learning Content */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Anonymized Pattern / Learning Description</label>
                <textarea
                  rows={4}
                  required
                  placeholder="e.g. Anonymized insights details..."
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3.5 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingEntry(null);
                }}
                className="flex-1 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !formContent.trim()}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Update entry</span>}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
