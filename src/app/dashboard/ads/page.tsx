"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Sparkles,
  Settings,
  Loader2,
  AlertCircle,
  Lock,
  Play,
  Pause,
  Wrench,
  Table,
  CheckSquare
} from "lucide-react";

export default function MetaAdsManagerPage() {
  interface ClientItem {
    id: string;
    name: string;
    ad_budget: number;
  }

  interface PlanItem {
    id: string;
    client_id: string;
    month: string;
    strategy_summary: string;
    content_pillars: string[];
    content_calendar: unknown[];
    budget_summary: unknown;
    media_plan?: {
      objective?: string;
      campaign_structure?: string;
      audience_suggestion?: string;
      daily_budget_split?: string;
      expected_cpl_roas_range?: string;
    } | null;
    clients?: {
      name: string;
    } | null;
  }

  interface CampaignItem {
    id: string;
    client_id: string;
    platform: string;
    objective: string;
    budget_per_day: number;
    status: string;
    external_campaign_id: string;
    control_mode: string;
    optimisation_rules?: unknown;
    created_at: string;
    clients?: {
      name: string;
    } | null;
  }

  interface AuditLogItem {
    id: string;
    client_id: string;
    campaign_id: string | null;
    action_type: string;
    platform: string;
    payload: unknown;
    response: unknown;
    status: string;
    actor_role: string;
    created_at: string;
    clients?: {
      name: string;
    } | null;
  }

  const [activeTab, setActiveTab] = useState<"deploy" | "campaigns" | "audit">("deploy");

  // Database lists
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Deployment form states
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [controlMode, setControlMode] = useState<"draft_only" | "founder_approval_required" | "auto_within_budget">("draft_only");

  // AI Media Plan editing states
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [mediaPlanObjective, setMediaPlanObjective] = useState("OUTCOME_AWARENESS");
  const [mediaPlanStructure, setMediaPlanStructure] = useState("");
  const [mediaPlanAudience, setMediaPlanAudience] = useState("");
  const [mediaPlanSplit, setMediaPlanSplit] = useState("");
  const [mediaPlanCplRange, setMediaPlanCplRange] = useState("");

  // Autopilot Rules Modal states
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState("");
  const [minRoasScale, setMinRoasScale] = useState(2.0);
  const [increaseAmountScale, setIncreaseAmountScale] = useState(200);
  const [capBudgetScale, setCapBudgetScale] = useState(5000);
  const [maxRoasTrim, setMaxRoasTrim] = useState(1.8);
  const [targetBudgetTrim, setTargetBudgetTrim] = useState(800);
  const [consecutiveDaysTrim, setConsecutiveDaysTrim] = useState(2);
  const [maxRoasPause, setMaxRoasPause] = useState(1.2);
  const [consecutiveDaysPause, setConsecutiveDaysPause] = useState(3);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      // 1. Fetch clients
      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, name, ad_budget")
        .order("name", { ascending: true });
      setClients(clientsData || []);

      // 2. Fetch approved monthly plans
      const { data: plansData } = await supabase
        .from("monthly_plans")
        .select("*, clients(name)")
        .eq("status", "approved")
        .order("month", { ascending: false });
      setPlans(plansData || []);

      // 3. Fetch campaigns
      const { data: campaignsData } = await supabase
        .from("campaigns")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });
      setCampaigns(campaignsData || []);

      // 4. Fetch ad ops audit logs
      const { data: auditData } = await supabase
        .from("ad_ops_audit")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });
      setAuditLogs(auditData || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to load ads management workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load selected plan's media plan data when selection changes
  const activePlan = plans.find((p) => p.id === selectedPlanId);
  
  useEffect(() => {
    if (activePlan?.media_plan) {
      const mp = activePlan.media_plan;
      setMediaPlanObjective(mp.objective || "OUTCOME_AWARENESS");
      setMediaPlanStructure(mp.campaign_structure || "");
      setMediaPlanAudience(mp.audience_suggestion || "");
      setMediaPlanSplit(mp.daily_budget_split || "");
      setMediaPlanCplRange(mp.expected_cpl_roas_range || "");
    } else {
      setMediaPlanObjective("OUTCOME_AWARENESS");
      setMediaPlanStructure("");
      setMediaPlanAudience("");
      setMediaPlanSplit("");
      setMediaPlanCplRange("");
    }
    setEditingPlan(false);
  }, [selectedPlanId, activePlan]);

  const handleGenerateMediaPlan = async () => {
    if (!selectedPlanId) return;
    setGeneratingPlan(true);
    setError(null);
    try {
      const res = await fetch(`/api/planning/${selectedPlanId}/generate-media-plan`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Media Plan generation failed");
      }

      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate media plan suggestion.");
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSaveAndApproveMediaPlan = async () => {
    if (!selectedPlanId) return;
    setActionLoading("approve_plan");
    setError(null);
    try {
      const editedPlan = {
        objective: mediaPlanObjective,
        campaign_structure: mediaPlanStructure,
        audience_suggestion: mediaPlanAudience,
        daily_budget_split: mediaPlanSplit,
        expected_cpl_roas_range: mediaPlanCplRange,
      };

      const res = await fetch(`/api/planning/${selectedPlanId}/approve-media-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaPlan: editedPlan }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save plan approval");
      }

      setEditingPlan(false);
      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save and approve media plan.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeployCampaign = async () => {
    if (!selectedPlanId || !selectedClientId || !controlMode) return;
    setActionLoading("deploy");
    setError(null);
    try {
      const res = await fetch("/api/campaigns/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanId,
          clientId: selectedClientId,
          controlMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Campaign deployment pipeline failed.");
      }

      // Success, move to campaigns tab and reload data
      setActiveTab("campaigns");
      await fetchData();
      // Reset selections
      setSelectedPlanId("");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to deploy paused campaign structure.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenRulesModal = (campaign: CampaignItem) => {
    setActiveCampaignId(campaign.id);
    const rules = (campaign.optimisation_rules || {}) as Record<string, Record<string, number>>;
    setMinRoasScale(rules.scale_condition?.min_roas ?? 2.0);
    setIncreaseAmountScale(rules.scale_condition?.increase_amount ?? 200);
    setCapBudgetScale(rules.scale_condition?.cap_budget ?? 5000);
    setMaxRoasTrim(rules.trim_condition?.max_roas ?? 1.8);
    setTargetBudgetTrim(rules.trim_condition?.target_budget ?? 800);
    setConsecutiveDaysTrim(rules.trim_condition?.consecutive_days ?? 2);
    setMaxRoasPause(rules.pause_condition?.max_roas ?? 1.2);
    setConsecutiveDaysPause(rules.pause_condition?.consecutive_days ?? 3);
    setIsRulesModalOpen(true);
  };

  const handleSaveRules = async () => {
    if (!activeCampaignId) return;
    setActionLoading("save_rules");
    setError(null);
    try {
      const updatedRules = {
        scale_condition: {
          min_roas: Number(minRoasScale),
          increase_amount: Number(increaseAmountScale),
          cap_budget: Number(capBudgetScale),
        },
        trim_condition: {
          max_roas: Number(maxRoasTrim),
          target_budget: Number(targetBudgetTrim),
          consecutive_days: Number(consecutiveDaysTrim),
        },
        pause_condition: {
          max_roas: Number(maxRoasPause),
          consecutive_days: Number(consecutiveDaysPause),
        },
      };

      const res = await fetch(`/api/campaigns/${activeCampaignId}/optimisation-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: updatedRules }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save optimisation rules");
      }

      setIsRulesModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save rules.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTriggerAutopilot = async () => {
    setActionLoading("autopilot");
    setError(null);
    try {
      const res = await fetch("/api/cron/reporting", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Autopilot trigger failed");
      }

      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to run ads autopilot.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleCampaignStatus = async (campaignId: string, currentStatus: string) => {
    setActionLoading(campaignId);
    setError(null);
    try {
      const nextStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
      const res = await fetch(`/api/campaigns/${campaignId}/toggle-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Toggle action failed");
      }

      await fetchData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to toggle status.");
    } finally {
      setActionLoading(null);
    }
  };

  const activeClientPlans = plans.filter((p) => p.client_id === selectedClientId);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-900 pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-1.5 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Megaphone className="w-4 h-4" />
            <span>Meta Ads Orchestrator</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Marketing Campaigns Hub</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTriggerAutopilot}
            disabled={actionLoading === "autopilot"}
            className="bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-800 text-indigo-300 font-bold py-2.5 px-4 rounded-xl cursor-pointer text-[9px] flex items-center space-x-1.5 uppercase tracking-wider disabled:opacity-40"
          >
            {actionLoading === "autopilot" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Run Autopilot</span>
              </>
            )}
          </button>

          {/* Tab Controls */}
          <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveTab("deploy")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "deploy"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Planner</span>
          </button>
          
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "campaigns"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Deploy Board</span>
          </button>

          <button
            onClick={() => setActiveTab("audit")}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg cursor-pointer transition-all ${
              activeTab === "audit"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Audit Ledger</span>
          </button>
        </div>
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
          
          {/* Tab 1: AI Planner Desk */}
          {activeTab === "deploy" && (
            <div className="grid md:grid-cols-3 gap-6">
              
              {/* Selectors panel */}
              <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-5 space-y-4 text-xs h-fit">
                <h3 className="text-sm font-bold text-white mb-2.5">Configure Target</h3>
                
                {/* Select Client */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wide">Client Brand</label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => {
                      setSelectedClientId(e.target.value);
                      setSelectedPlanId("");
                    }}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">-- Select Brand --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Budget: Rs. {c.ad_budget || 0})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Select Monthly Plan */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wide">Approved Plan</label>
                  <select
                    disabled={!selectedClientId}
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-3 text-xs text-white focus:outline-none cursor-pointer disabled:opacity-30"
                  >
                    <option value="">-- Choose Calendar Plan --</option>
                    {activeClientPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        Plan: {new Date(p.month).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Select Control Mode */}
                <div className="space-y-1 pt-1.5 border-t border-slate-900">
                  <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wide mb-1">Control Mode</label>
                  <div className="space-y-2">
                    {[
                      { key: "draft_only", label: "Draft Only", desc: "API created paused, never activate." },
                      { key: "founder_approval_required", label: "Founder Approval Required", desc: "One-tap activation toggle via phone." },
                      { key: "auto_within_budget", label: "Auto Within Budget", desc: "Authorize pacing edits within a daily cap." }
                    ].map((mode) => (
                      <label key={mode.key} className="flex items-start space-x-2.5 bg-slate-900/30 border border-slate-900 p-2.5 rounded-xl cursor-pointer hover:border-slate-800 transition-colors block">
                        <input
                          type="radio"
                          name="controlModeRadio"
                          checked={controlMode === mode.key}
                          onChange={() => setControlMode(mode.key as "draft_only" | "founder_approval_required" | "auto_within_budget")}
                          className="mt-0.5 accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <span className="font-semibold text-slate-200 text-[10.5px] block">{mode.label}</span>
                          <span className="text-[9px] text-slate-500 block leading-tight">{mode.desc}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDeployCampaign}
                    disabled={!selectedPlanId || actionLoading === "deploy" || !activePlan?.media_plan?.objective}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl cursor-pointer text-[10px] flex items-center justify-center space-x-1.5 uppercase tracking-wider disabled:opacity-40"
                  >
                    {actionLoading === "deploy" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Megaphone className="w-3.5 h-3.5" />
                        <span>Deploy paused campaign</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Media Plan Suggestions workspace */}
              <div className="md:col-span-2 bg-slate-950/40 border border-slate-900 rounded-3xl p-6 space-y-5 text-xs">
                
                {/* Suggestion header */}
                <div className="flex justify-between items-center border-b border-slate-900 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Ad Media Plan</h3>
                    <p className="text-[10px] text-slate-500">Draft objectives, daily pacing splits, and audience Suggestions.</p>
                  </div>

                  {selectedPlanId && !activePlan?.media_plan?.objective && (
                    <button
                      type="button"
                      onClick={handleGenerateMediaPlan}
                      disabled={generatingPlan}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg cursor-pointer text-[10px] flex items-center space-x-1 uppercase tracking-wider"
                    >
                      {generatingPlan ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Generate suggestion</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {!selectedPlanId ? (
                  <div className="text-center py-20 text-slate-600 text-[10px] italic">
                    Choose a targets client and an approved plan to inspect the media suggestion details.
                  </div>
                ) : !activePlan?.media_plan?.objective ? (
                  <div className="text-center py-16 space-y-3">
                    <p className="text-slate-500 max-w-xs mx-auto text-[10px]">No media plan suggestions generated yet. Click generate to feed calendar budget schemas to Gemini.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    
                    {/* View/Edit form */}
                    {editingPlan ? (
                      <div className="space-y-3.5 text-xs max-w-xl">
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[9.5px] font-bold text-slate-500 uppercase tracking-wide">Meta Objective</label>
                            <select
                              value={mediaPlanObjective}
                              onChange={(e) => setMediaPlanObjective(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white focus:outline-none cursor-pointer"
                            >
                              <option value="OUTCOME_AWARENESS">AWARENESS</option>
                              <option value="OUTCOME_SALES">SALES</option>
                              <option value="OUTCOME_LEADS">LEADS</option>
                              <option value="OUTCOME_ENGAGEMENT">ENGAGEMENT</option>
                              <option value="OUTCOME_TRAFFIC">TRAFFIC</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[9.5px] font-bold text-slate-500 uppercase tracking-wide">ROAS / CPL Target</label>
                            <input
                              type="text"
                              value={mediaPlanCplRange}
                              onChange={(e) => setMediaPlanCplRange(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white focus:outline-none"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[9.5px] font-bold text-slate-500 uppercase tracking-wide">Ad Set structure</label>
                          <input
                            type="text"
                            value={mediaPlanStructure}
                            onChange={(e) => setMediaPlanStructure(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white focus:outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[9.5px] font-bold text-slate-500 uppercase tracking-wide">Audience Demographics</label>
                          <textarea
                            rows={3}
                            value={mediaPlanAudience}
                            onChange={(e) => setMediaPlanAudience(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white focus:outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[9.5px] font-bold text-slate-500 uppercase tracking-wide">Daily budget distribution</label>
                          <input
                            type="text"
                            value={mediaPlanSplit}
                            onChange={(e) => setMediaPlanSplit(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white focus:outline-none"
                          />
                        </div>

                        <div className="flex space-x-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingPlan(false)}
                            className="bg-slate-900 hover:bg-slate-850 text-slate-400 px-4 py-2 rounded-xl text-[10px] font-bold"
                          >
                            Cancel
                          </button>
                          
                          <button
                            type="button"
                            onClick={handleSaveAndApproveMediaPlan}
                            disabled={actionLoading === "approve_plan"}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-[10px] font-bold flex items-center space-x-1"
                          >
                            {actionLoading === "approve_plan" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <CheckSquare className="w-3.5 h-3.5" />
                                <span>Save & Approve</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-900/10 border border-slate-900 p-3.5 rounded-xl space-y-1">
                            <span className="text-[8.5px] text-slate-500 uppercase font-mono tracking-widest block">Objective</span>
                            <span className="text-xs font-bold text-slate-200 block">{mediaPlanObjective}</span>
                          </div>

                          <div className="bg-slate-900/10 border border-slate-900 p-3.5 rounded-xl space-y-1">
                            <span className="text-[8.5px] text-slate-500 uppercase font-mono tracking-widest block">ROAS / CPL Target</span>
                            <span className="text-xs font-bold text-slate-200 block">{mediaPlanCplRange}</span>
                          </div>
                        </div>

                        <div className="bg-slate-900/10 border border-slate-900 p-3.5 rounded-xl space-y-1">
                          <span className="text-[8.5px] text-slate-500 uppercase font-mono tracking-widest block">Adset & Ads structure</span>
                          <p className="text-xs font-semibold text-slate-200 leading-normal">{mediaPlanStructure}</p>
                        </div>

                        <div className="bg-slate-900/10 border border-slate-900 p-3.5 rounded-xl space-y-1">
                          <span className="text-[8.5px] text-slate-500 uppercase font-mono tracking-widest block">Audience Targeting Suggestion</span>
                          <p className="text-xs text-slate-300 leading-relaxed">{mediaPlanAudience}</p>
                        </div>

                        <div className="bg-slate-900/10 border border-slate-900 p-3.5 rounded-xl space-y-1">
                          <span className="text-[8.5px] text-slate-500 uppercase font-mono tracking-widest block">Daily Budget Split Pacing</span>
                          <p className="text-xs font-semibold text-slate-200">{mediaPlanSplit}</p>
                        </div>

                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingPlan(true)}
                            className="flex items-center space-x-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 px-4.5 py-2.5 rounded-xl text-[10px] font-bold cursor-pointer transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Edit Media Plan Suggestions</span>
                          </button>
                        </div>

                      </div>
                    )}

                  </div>
                )}

              </div>

            </div>
          )}

          {/* Tab 2: Campaigns Board */}
          {activeTab === "campaigns" && (
            <div className="space-y-4">
              
              {campaigns.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500 text-xs">
                  No deployed campaigns found in database. Configure targets to deploy.
                </div>
              ) : (
                <div className="grid gap-4">
                  {campaigns.map((c) => (
                    <div
                      key={c.id}
                      className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                            {c.clients?.name}
                          </span>
                          
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                            c.status === "ACTIVE"
                              ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                              : "bg-amber-950/40 border border-amber-900/50 text-amber-400"
                          }`}>
                            Meta: {c.status}
                          </span>

                          <span className="text-[8.5px] bg-slate-900/60 text-slate-500 px-2 py-0.5 rounded border border-slate-850 uppercase font-mono">
                            Mode: {c.control_mode.replace(/_/g, " ")}
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-white leading-tight">Meta Campaign</h4>
                        
                        <div className="text-[9.5px] text-slate-550 font-mono space-y-0.5">
                          <div>Objective: {c.objective}</div>
                          <div>Daily Pacing Budget Cap: Rs. {c.budget_per_day}</div>
                          <div className="truncate">External Campaign ID: {c.external_campaign_id}</div>
                        </div>
                      </div>

                      <div className="flex items-center shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenRulesModal(c)}
                          className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-805 text-slate-300 px-3.5 py-2.5 rounded-xl font-bold cursor-pointer text-[10px] transition-all"
                        >
                          <Settings className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Rules</span>
                        </button>

                        {c.control_mode === "draft_only" ? (
                          <span className="text-[9px] text-slate-500 bg-slate-900/40 border border-slate-850 px-3 py-2 rounded-xl font-bold flex items-center space-x-1">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Locked (Draft Mode)</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleCampaignStatus(c.id, c.status)}
                            disabled={actionLoading === c.id}
                            className={`w-full md:w-auto font-bold py-2.5 px-4 rounded-xl cursor-pointer text-[10px] flex items-center justify-center space-x-1.5 uppercase tracking-wider ${
                              c.status === "ACTIVE"
                                ? "bg-amber-950/20 hover:bg-amber-950/40 border border-amber-900 text-amber-400"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg"
                            }`}
                          >
                            {actionLoading === c.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : c.status === "ACTIVE" ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Pause campaign</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Activate campaign</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}

          {/* Tab 3: Audit Ledger */}
          {activeTab === "audit" && (
            <div className="space-y-4">
              
              {auditLogs.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500 text-xs">
                  No ad operations API audit records found. Deploys campaign to generate logs.
                </div>
              ) : (
                <div className="bg-slate-950/30 border border-slate-900 rounded-2xl overflow-hidden text-[10px] text-left">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-900 text-slate-400 font-bold uppercase tracking-wider text-[8px] font-mono">
                          <th className="p-3 text-left">Timestamp</th>
                          <th className="p-3 text-left">Brand</th>
                          <th className="p-3 text-left">Action</th>
                          <th className="p-3 text-left">Platform</th>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-left">Response Payload</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-900/10 transition-colors">
                            <td className="p-3 text-slate-500 font-mono whitespace-nowrap">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            
                            <td className="p-3 font-semibold text-slate-300">
                              {log.clients?.name}
                            </td>

                            <td className="p-3 whitespace-nowrap font-mono font-bold text-slate-200">
                              {log.action_type.replace(/_/g, " ")}
                            </td>

                            <td className="p-3 whitespace-nowrap text-slate-450 uppercase font-mono">
                              {log.platform}
                            </td>

                            <td className="p-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider ${
                                log.status === "success"
                                  ? "bg-emerald-950/40 text-emerald-450 border border-emerald-900/40"
                                  : "bg-red-950/40 text-red-450 border border-red-900/50"
                              }`}>
                                {log.status}
                              </span>
                            </td>

                            <td className="p-3 font-mono text-[9px] text-slate-400 max-w-xs truncate">
                              {JSON.stringify(log.response)}
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

      {/* Autopilot Rules Modal */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in text-left">
          <div className="bg-slate-950 border border-slate-900 rounded-3xl max-w-lg w-full p-6 space-y-5 text-xs shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Configure Autopilot Rules</h3>
                <p className="text-[10px] text-slate-550">Define Hold, Scale, Trim, and Pause conditions.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsRulesModalOpen(false)}
                className="text-slate-500 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              
              {/* Scale Condition */}
              <div className="space-y-2 border-b border-slate-900 pb-3">
                <h4 className="font-bold text-indigo-400">1. Hold & Scale Rule</h4>
                <p className="text-[10px] text-slate-500">If blended ROAS is above threshold, scale the budget daily.</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Min ROAS (x)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={minRoasScale}
                      onChange={(e) => setMinRoasScale(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Increase (Rs.)</label>
                    <input
                      type="number"
                      value={increaseAmountScale}
                      onChange={(e) => setIncreaseAmountScale(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Max Cap (Rs.)</label>
                    <input
                      type="number"
                      value={capBudgetScale}
                      onChange={(e) => setCapBudgetScale(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Trim Condition */}
              <div className="space-y-2 border-b border-slate-900 pb-3">
                <h4 className="font-bold text-amber-400">2. Trim Budget Rule</h4>
                <p className="text-[10px] text-slate-500">If ROAS is below threshold for consecutive days, trim budget.</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Max ROAS (x)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={maxRoasTrim}
                      onChange={(e) => setMaxRoasTrim(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Trim To (Rs.)</label>
                    <input
                      type="number"
                      value={targetBudgetTrim}
                      onChange={(e) => setTargetBudgetTrim(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Days Trigger</label>
                    <input
                      type="number"
                      value={consecutiveDaysTrim}
                      onChange={(e) => setConsecutiveDaysTrim(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Pause Condition */}
              <div className="space-y-2 pb-1">
                <h4 className="font-bold text-red-400">3. Pause Campaign Rule</h4>
                <p className="text-[10px] text-slate-500">If ROAS drops below threshold for consecutive days, pause campaign.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Max ROAS (x)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={maxRoasPause}
                      onChange={(e) => setMaxRoasPause(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] text-slate-550 uppercase">Days Trigger</label>
                    <input
                      type="number"
                      value={consecutiveDaysPause}
                      onChange={(e) => setConsecutiveDaysPause(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-900">
              <button
                type="button"
                onClick={() => setIsRulesModalOpen(false)}
                className="bg-slate-900 hover:bg-slate-850 text-slate-400 px-4 py-2.5 rounded-xl font-bold cursor-pointer"
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={handleSaveRules}
                disabled={actionLoading === "save_rules"}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center space-x-1 cursor-pointer"
              >
                {actionLoading === "save_rules" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Save Rules</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
      )}

    </div>
  );
}
