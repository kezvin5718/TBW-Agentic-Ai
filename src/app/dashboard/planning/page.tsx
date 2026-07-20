"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  Briefcase
} from "lucide-react";

export default function PlanningIndexPage() {
  interface ClientListItem {
    id: string;
    name: string;
    deliverables_per_month: number;
    ad_budget: number;
  }

  interface PlanListItem {
    id: string;
    month: string;
    status: string;
    strategy_summary: string | null;
    clients: { name: string } | null;
  }

  interface CalendarSlot {
    date: string;
    platform: string;
    format: string;
    concept: string;
    hook: string;
    CTA: string;
  }

  interface BudgetAllocation {
    objective: string;
    percentage: number;
    amount: number;
    rationale: string;
  }

  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state machine
  const [wizardStep, setWizardStep] = useState(0); // 0: Config, 1: Strategy, 2: Calendar, 3: Budget
  const [generating, setGenerating] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState("");

  // Step 0 states
  const [selectedClient, setSelectedClient] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("2026-08-01");

  // Step 1 states (Strategy)
  const [strategySummary, setStrategySummary] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [pillarInput, setPillarInput] = useState("");

  // Step 2 states (Calendar)
  const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);

  // Step 3 states (Budget)
  const [budgetAllocations, setBudgetAllocations] = useState<BudgetAllocation[]>([]);

  const fetchIndexData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Let's use supabase client directly on client side!
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, name, deliverables_per_month, ad_budget")
        .order("name");

      const { data: plansData } = await supabase
        .from("monthly_plans")
        .select("id, month, status, strategy_summary, clients(name)")
        .order("month", { ascending: false });

      setClients((clientsData as unknown as ClientListItem[]) || []);
      setPlans((plansData as unknown as PlanListItem[]) || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to load plans list. Ensure migrations have been applied.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndexData();
  }, [fetchIndexData]);

  const handleStartWizard = () => {
    if (clients.length === 0) {
      setError("Please onboard at least one client before generating a plan.");
      return;
    }
    setSelectedClient(clients[0].id);
    setWizardStep(0);
    setCreating(true);
    setError(null);
  };

  // Step 1 Trigger: Generate Strategy summary
  const triggerGenerateStrategy = async () => {
    setGenerating(true);
    setLoaderMessage("AI Strategy Bot: Digesting brand briefs, past creative feedback logs, and market results...");
    setError(null);

    try {
      const response = await fetch("/api/planning/generate-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate strategy");
      }

      setStrategySummary(data.strategySummary);
      setPillars(data.contentPillars || []);
      setWizardStep(1);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate monthly strategy.");
    } finally {
      setGenerating(false);
    }
  };

  // Add/Remove Content pillars manually
  const handleAddPillar = () => {
    if (pillarInput.trim() && !pillars.includes(pillarInput.trim())) {
      setPillars([...pillars, pillarInput.trim()]);
      setPillarInput("");
    }
  };

  const handleRemovePillar = (idx: number) => {
    setPillars(pillars.filter((_, i) => i !== idx));
  };

  // Step 2 Trigger: Generate Content calendar slots
  const triggerGenerateCalendar = async () => {
    setGenerating(true);
    setLoaderMessage("AI Production Bot: Formulating hooks, body concepts, CTAs and distributing dates...");
    setError(null);

    try {
      const response = await fetch("/api/planning/generate-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          strategySummary,
          contentPillars: pillars,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate content calendar");
      }

      setCalendarSlots(data.calendar || []);
      setWizardStep(2);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate calendar slots.");
    } finally {
      setGenerating(false);
    }
  };

  // Edit calendar fields in wizard
  const handleCalendarChange = (index: number, field: string, value: string) => {
    const updated = [...calendarSlots];
    updated[index] = { ...updated[index], [field]: value };
    setCalendarSlots(updated);
  };

  const handleRemoveCalendarSlot = (index: number) => {
    setCalendarSlots(calendarSlots.filter((_, i) => i !== index));
  };

  const handleAddCalendarSlot = () => {
    setCalendarSlots([
      ...calendarSlots,
      {
        date: selectedMonth,
        platform: "instagram",
        format: "reel",
        concept: "New Promo Concept",
        hook: "Intriguing opener",
        CTA: "Shop now",
      },
    ]);
  };

  // Step 3 Trigger: Generate Budget Splits
  const triggerGenerateBudget = async () => {
    setGenerating(true);
    setLoaderMessage("AI Media Planner: Optimizing ad budget allocation across conversion, leads and engagement objectives...");
    setError(null);

    const clientObj = clients.find((c) => c.id === selectedClient);
    const budgetVal = clientObj ? clientObj.ad_budget : 100000;

    try {
      const response = await fetch("/api/planning/generate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          adBudget: budgetVal,
          strategySummary,
          contentCalendar: calendarSlots,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate budget allocations");
      }

      setBudgetAllocations(data.allocations || []);
      setWizardStep(3);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate budget splits.");
    } finally {
      setGenerating(false);
    }
  };

  // Edit budget splits
  const handleBudgetChange = (index: number, field: string, value: string | number) => {
    const updated = [...budgetAllocations];
    updated[index] = { ...updated[index], [field]: value };
    setBudgetAllocations(updated);
  };

  // Step 4: Save plan to DB
  const handleSavePlan = async () => {
    setGenerating(true);
    setLoaderMessage("Synthesizing final dashboard structures and saving Monthly Plan draft...");
    setError(null);

    try {
      const response = await fetch("/api/planning/save-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          strategySummary,
          contentPillars: pillars,
          contentCalendar: calendarSlots,
          budgetSummary: { allocations: budgetAllocations },
          status: "draft",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save monthly plan");
      }

      setCreating(false);
      fetchIndexData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save completed plan.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Index view header */}
      {!creating && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
          <div>
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
              <Calendar className="w-4 h-4" />
              <span>Strategy Room</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Monthly Strategy Plans</h1>
            <p className="text-slate-400 text-xs mt-1">Develop content grids, pillars, and budget schedules per client</p>
          </div>

          <button
            onClick={handleStartWizard}
            className="flex items-center justify-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2.5 px-5 rounded-xl text-xs shadow-lg shadow-indigo-950/40 cursor-pointer"
          >
            <span>Create Monthly Plan</span>
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs flex items-start space-x-2">
          <span>{error}</span>
        </div>
      )}

      {creating ? (
        /* WIZARD CONTAINER */
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-8 relative">
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          {/* Stepper Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6 text-xs text-slate-500">
            <span className={wizardStep === 0 ? "text-indigo-400 font-bold" : "text-slate-400"}>0. Client Config</span>
            <span className="text-slate-800">/</span>
            <span className={wizardStep === 1 ? "text-indigo-400 font-bold" : "text-slate-400"}>1. Strategy pillars</span>
            <span className="text-slate-800">/</span>
            <span className={wizardStep === 2 ? "text-indigo-400 font-bold" : "text-slate-400"}>2. Calendar slots</span>
            <span className="text-slate-800">/</span>
            <span className={wizardStep === 3 ? "text-indigo-400 font-bold" : "text-slate-400"}>3. Spend Allocation</span>
          </div>

          {generating ? (
            /* Generating spinner overlay */
            <div className="py-20 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              <div className="text-center space-y-1 max-w-sm">
                <p className="text-xs text-indigo-300 font-semibold animate-pulse">Consulting Strategic Engine...</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">{loaderMessage}</p>
              </div>
            </div>
          ) : (
            /* STEP CONTENT switch */
            <div className="space-y-6">
              
              {/* STEP 0: Configure client and month */}
              {wizardStep === 0 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Set Client Parameters</h3>
                    <p className="text-[10px] text-slate-500">Select target account and month duration</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Select Client</label>
                      <select
                        value={selectedClient}
                        onChange={(e) => setSelectedClient(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white focus:outline-none"
                      >
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Target Month</label>
                      <input
                        type="date"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8">
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="text-xs text-slate-500 hover:text-white py-2 px-4 border border-slate-800 rounded-xl transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={triggerGenerateStrategy}
                      className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer shadow-lg shadow-indigo-950/30"
                    >
                      <span>Generate Strategy</span>
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 1: Edit Strategy and content pillars */}
              {wizardStep === 1 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Step 1: Edit Strategy Summary</h3>
                    <p className="text-[10px] text-slate-500">Fine-tune the goals and focus pillars before generating content slots</p>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Strategy Summary & Goals</label>
                      <textarea
                        rows={6}
                        value={strategySummary}
                        onChange={(e) => setStrategySummary(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white placeholder-slate-600 focus:outline-none resize-none leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Content Pillars</label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          placeholder="e.g. Spice Heritage Stories"
                          value={pillarInput}
                          onChange={(e) => setPillarInput(e.target.value)}
                          className="bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white placeholder-slate-600 focus:outline-none flex-1"
                        />
                        <button
                          type="button"
                          onClick={handleAddPillar}
                          className="px-3 bg-indigo-950/40 border border-indigo-900 text-indigo-300 rounded-xl font-bold cursor-pointer hover:bg-indigo-900/40"
                        >
                          Add
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-3">
                        {pillars.map((pillar, idx) => (
                          <div key={idx} className="flex items-center space-x-1.5 bg-indigo-950/30 border border-indigo-900/50 py-1.5 px-2.5 rounded-lg text-[10px] font-semibold text-indigo-400">
                            <span>{pillar}</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePillar(idx)}
                              className="text-indigo-600 hover:text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(0)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <button
                      type="button"
                      onClick={triggerGenerateCalendar}
                      className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer"
                    >
                      <span>Generate Calendar</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Edit Content Calendar */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">Step 2: Edit Content Calendar</h3>
                      <p className="text-[10px] text-slate-500">Edit concept themes, dates, hooks, or add new deliverable slots</p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddCalendarSlot}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-900 text-[10px] font-bold text-indigo-300 hover:bg-indigo-900/40 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Slot</span>
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                    {calendarSlots.map((slot, idx) => (
                      <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4.5 space-y-3.5 relative">
                        <button
                          type="button"
                          onClick={() => handleRemoveCalendarSlot(idx)}
                          className="absolute top-4 right-4 text-slate-600 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Date</label>
                            <input
                              type="date"
                              value={slot.date}
                              onChange={(e) => handleCalendarChange(idx, "date", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Platform</label>
                            <select
                              value={slot.platform}
                              onChange={(e) => handleCalendarChange(idx, "platform", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            >
                              <option value="instagram">Instagram</option>
                              <option value="facebook">Facebook</option>
                              <option value="youtube">YouTube</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Format</label>
                            <select
                              value={slot.format}
                              onChange={(e) => handleCalendarChange(idx, "format", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            >
                              <option value="reel">Reel Video</option>
                              <option value="carousel">Carousel</option>
                              <option value="static">Static Image</option>
                            </select>
                          </div>
                        </div>

                        <div className="text-xs space-y-2">
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Concept Concept</label>
                            <input
                              type="text"
                              value={slot.concept}
                              onChange={(e) => handleCalendarChange(idx, "concept", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Intro Hook</label>
                              <textarea
                                rows={2}
                                value={slot.hook}
                                onChange={(e) => handleCalendarChange(idx, "hook", e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Call-To-Action (CTA)</label>
                              <textarea
                                rows={2}
                                value={slot.CTA}
                                onChange={(e) => handleCalendarChange(idx, "CTA", e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <button
                      type="button"
                      onClick={triggerGenerateBudget}
                      className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer"
                    >
                      <span>Allocate Budget</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Edit Budget Allocations */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Step 3: Edit Budget splits</h3>
                    <p className="text-[10px] text-slate-500">Fine-tune spend ratios across campaign objectives</p>
                  </div>

                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 text-xs">
                    {budgetAllocations.map((alloc, idx) => (
                      <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4 space-y-3.5">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Objective</label>
                            <input
                              type="text"
                              value={alloc.objective}
                              onChange={(e) => handleBudgetChange(idx, "objective", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Percentage (%)</label>
                            <input
                              type="number"
                              value={alloc.percentage}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const totalBudget = clients.find(c => c.id === selectedClient)?.ad_budget || 100000;
                                handleBudgetChange(idx, "percentage", val);
                                handleBudgetChange(idx, "amount", (val / 100) * totalBudget);
                              }}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Rationale</label>
                          <textarea
                            rows={2}
                            value={alloc.rationale}
                            onChange={(e) => handleBudgetChange(idx, "rationale", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={handleSavePlan}
                      className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2.5 px-5 rounded-xl cursor-pointer"
                    >
                      <span>Finalize & Save Draft</span>
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      ) : (
        /* PLANS INDEX LIST */
        <div className="space-y-4">
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-2">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <span className="text-[10px] text-slate-500 font-medium">Loading Monthly Plans...</span>
            </div>
          ) : plans.length === 0 ? (
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Briefcase className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-300">No Monthly Plans</h3>
                <p className="text-xs text-slate-500 mt-1">Select the create button above to draft your first client plan.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {plans.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/dashboard/planning/${plan.id}`}
                  className="group bg-slate-950/40 border border-slate-900 hover:border-slate-800 rounded-xl p-4.5 flex items-center justify-between transition-all"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors text-sm">
                        {plan.clients?.name || "Client"}
                      </h4>
                      <span className="text-[10px] text-slate-500 font-mono">
                        ({new Date(plan.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })})
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-1 max-w-[500px]">
                      {plan.strategy_summary?.replace(/Goals:|Central Focus:/g, "") || "No strategy summary drafted."}
                    </p>
                  </div>

                  <div className="flex items-center space-x-3.5 text-xs">
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                      plan.status === "approved" || plan.status === "internal_review"
                        ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                        : plan.status === "rejected"
                        ? "bg-red-950/40 border border-red-900 text-red-400"
                        : "bg-slate-900 border border-slate-800 text-slate-400"
                    }`}>
                      {plan.status === "internal_review" ? "Int. Approved" : plan.status}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
