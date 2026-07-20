"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Printer,
  Calendar,
  TrendingUp,
  MessageSquare,
  ShieldAlert
} from "lucide-react";

export default function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: planId } = use(params);
  const router = useRouter();

  interface ClientDetails {
    id: string;
    name: string;
    ad_budget: number;
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

  interface PlanDetails {
    id: string;
    client_id: string;
    month: string;
    strategy_summary: string | null;
    content_pillars: string[];
    content_calendar: CalendarSlot[];
    budget_summary: {
      allocations?: BudgetAllocation[];
    };
    status: string;
    clients: ClientDetails;
  }

  // Data states
  const [plan, setPlan] = useState<PlanDetails | null>(null);
  const [client, setClient] = useState<ClientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review states
  const [submittingStatus, setSubmittingStatus] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");

  // Re-generation state inside details page
  const [regenerating, setRegenerating] = useState(false);

  // WhatsApp states
  const [sendingToWhatsApp, setSendingToWhatsApp] = useState(false);
  const [clientFeedback, setClientFeedback] = useState<string | null>(null);

  const fetchPlanData = useCallback(async () => {
    try {
      setLoading(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data: planData, error: planErr } = await supabase
        .from("monthly_plans")
        .select("*, clients(*)")
        .eq("id", planId)
        .single();

      if (planErr || !planData) {
        throw new Error(planErr?.message || "Plan not found");
      }

      setPlan(planData as unknown as PlanDetails);
      setClient((planData as unknown as PlanDetails).clients);

      // Fetch the most recent rejected client approval to display feedback notes
      const { data: revisionApproval } = await supabase
        .from("approvals")
        .select("feedback_text")
        .eq("entity_id", planId)
        .eq("entity_type", "plan")
        .eq("decision", "rejected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setClientFeedback(revisionApproval?.feedback_text || null);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load plan details.");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanData();
  }, [planId, fetchPlanData]);

  // Founder Approve Action
  const handleApprove = async () => {
    setSubmittingStatus(true);
    setError(null);

    try {
      const response = await fetch(`/api/planning/${planId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "internal_review",
          notes: "Approved by Founder via Dashboard console.",
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to approve plan");
      }

      await fetchPlanData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during approval.");
    } finally {
      setSubmittingStatus(false);
    }
  };

  // Founder Reject & Regenerate Loop Action
  const handleRejectAndRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectNotes.trim() || !plan || !client) return;

    setRegenerating(true);
    setError(null);
    setShowRejectForm(false);

    try {
      // 1. Mark status as rejected in DB
      const statusResponse = await fetch(`/api/planning/${planId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          notes: rejectNotes,
        }),
      });

      if (!statusResponse.ok) {
        const errData = await statusResponse.json();
        throw new Error(errData.error || "Failed to update status to rejected");
      }

      // 2. Call strategy generator API passing rejectNotes to trigger AI regeneration
      const stratResponse = await fetch("/api/planning/generate-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          rejectNotes,
        }),
      });

      const stratData = await stratResponse.json();
      if (!stratResponse.ok) {
        throw new Error(stratData.error || "Regeneration of strategy failed");
      }

      // 3. Call calendar generator based on new strategy
      const calResponse = await fetch("/api/planning/generate-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          strategySummary: stratData.strategySummary,
          contentPillars: stratData.contentPillars,
        }),
      });

      const calData = await calResponse.json();
      if (!calResponse.ok) {
        throw new Error(calData.error || "Regeneration of calendar failed");
      }

      // 4. Call budget generator based on new strategy and calendar
      const budgetResponse = await fetch("/api/planning/generate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          adBudget: client.ad_budget,
          strategySummary: stratData.strategySummary,
          contentCalendar: calData.calendar,
        }),
      });

      const budgetData = await budgetResponse.json();
      if (!budgetResponse.ok) {
        throw new Error(budgetData.error || "Regeneration of budget failed");
      }

      // 5. Update monthly plan in DB
      const saveResponse = await fetch("/api/planning/save-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          strategySummary: stratData.strategySummary,
          contentPillars: stratData.contentPillars,
          contentCalendar: calData.calendar,
          budgetSummary: { allocations: budgetData.allocations },
          status: "draft", // Reset to draft for review
        }),
      });

      if (!saveResponse.ok) {
        const saveData = await saveResponse.json();
        throw new Error(saveData.error || "Failed to save regenerated plan");
      }

      setRejectNotes("");
      await fetchPlanData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during regeneration.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleSendToClient = async () => {
    setSendingToWhatsApp(true);
    setError(null);
    try {
      const res = await fetch(`/api/planning/${planId}/send-to-client`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to dispatch WhatsApp plan approval");
      }

      await fetchPlanData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to dispatch approval.");
    } finally {
      setSendingToWhatsApp(false);
    }
  };

  const handleClientFeedbackRegenerate = async (feedbackText: string) => {
    if (!plan || !client) return;

    setRegenerating(true);
    setError(null);

    try {
      // 1. strategy
      const stratResponse = await fetch("/api/planning/generate-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          rejectNotes: feedbackText,
        }),
      });

      const stratData = await stratResponse.json();
      if (!stratResponse.ok) throw new Error(stratData.error || "Regeneration of strategy failed");

      // 2. calendar
      const calResponse = await fetch("/api/planning/generate-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          strategySummary: stratData.strategySummary,
          contentPillars: stratData.contentPillars,
        }),
      });

      const calData = await calResponse.json();
      if (!calResponse.ok) throw new Error(calData.error || "Regeneration of calendar failed");

      // 3. budget
      const budgetResponse = await fetch("/api/planning/generate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          adBudget: client.ad_budget,
          strategySummary: stratData.strategySummary,
          contentCalendar: calData.calendar,
        }),
      });

      const budgetData = await budgetResponse.json();
      if (!budgetResponse.ok) throw new Error(budgetData.error || "Regeneration of budget failed");

      // 4. save
      const saveResponse = await fetch("/api/planning/save-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: plan.client_id,
          month: plan.month,
          strategySummary: stratData.strategySummary,
          contentPillars: stratData.contentPillars,
          contentCalendar: calData.calendar,
          budgetSummary: { allocations: budgetData.allocations },
          status: "draft",
        }),
      });

      if (!saveResponse.ok) {
        const saveData = await saveResponse.json();
        throw new Error(saveData.error || "Failed to save regenerated plan");
      }

      await fetchPlanData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during regeneration.");
    } finally {
      setRegenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-500 font-medium">Fetching Plan Details...</span>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="text-center p-8 bg-slate-950/20 border border-slate-900 rounded-2xl">
        <h3 className="text-sm font-semibold text-slate-400">Plan profile not found.</h3>
        <button onClick={() => router.push("/dashboard/planning")} className="mt-4 text-xs text-indigo-400 font-bold hover:underline">
          Return to list
        </button>
      </div>
    );
  }

  const isPendingReview = plan.status === "draft" || plan.status === "rejected";

  return (
    <div className="max-w-4xl mx-auto space-y-6 print:space-y-4 print:p-0">
      
      {/* Print Styles Sheet injected directly */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          header, footer, nav, button, .print-hide, .sidebar-container {
            display: none !important;
          }
          .main-content-wrapper {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .print-card {
            border: 1px solid #ddd !important;
            background: none !important;
            box-shadow: none !important;
            color: black !important;
            page-break-inside: avoid;
          }
          .print-text {
            color: black !important;
          }
          .print-title {
            color: #111 !important;
            border-bottom: 2px solid #000 !important;
            padding-bottom: 10px !important;
          }
        }
      `}</style>

      {/* Top Navigation Row */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4 print-hide">
        <Link
          href="/dashboard/planning"
          className="flex items-center space-x-1.5 text-xs text-slate-500 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Planning Room</span>
        </Link>

        <button
          onClick={handlePrint}
          className="flex items-center space-x-1.5 border border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-300 py-1.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>Export as PDF / Print</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 flex items-start space-x-3 text-red-200 text-sm print-hide">
          <ShieldAlert className="w-5 h-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {regenerating && (
        <div className="p-6 rounded-2xl bg-indigo-950/20 border border-indigo-900/50 flex flex-col items-center justify-center space-y-4 text-center print-hide">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <div>
            <p className="text-xs text-indigo-300 font-bold animate-pulse uppercase tracking-wider">AI Re-generation Loop Active</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-sm">Applying founder rejection notes... Re-synthesizing strategy, content calendar grids, and budget objective ratios...</p>
          </div>
        </div>
      )}

      {/* Plan Header Card */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 print-card">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider font-mono">Monthly plan</span>
            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
              plan.status === "approved" || plan.status === "internal_review" || plan.status === "sent_to_client"
                ? "bg-emerald-950/40 border border-emerald-800 text-emerald-400"
                : plan.status === "rejected"
                ? "bg-red-950/40 border border-red-800 text-red-400"
                : "bg-slate-900 border border-slate-800 text-slate-400"
            }`}>
              {plan.status === "internal_review"
                ? "Founder Approved"
                : plan.status === "sent_to_client"
                ? "Sent to Client"
                : plan.status}
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight print-title">
            {client?.name} — {new Date(plan.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </h2>
        </div>

        {/* Founder review actions */}
        {isPendingReview && !regenerating && (
          <div className="flex items-center space-x-3.5 print-hide border-t md:border-t-0 border-slate-900 pt-4 md:pt-0">
            <button
              onClick={() => setShowRejectForm(true)}
              disabled={submittingStatus}
              className="flex items-center space-x-1 border border-slate-800 hover:border-red-900/50 hover:bg-red-950/20 text-slate-400 hover:text-red-300 font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Reject with Notes</span>
            </button>
            
            <button
              onClick={handleApprove}
              disabled={submittingStatus}
              className="flex items-center space-x-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all shadow-md shadow-emerald-950/40"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve Plan</span>
            </button>
          </div>
        )}

        {/* Send to client action */}
        {plan.status === "internal_review" && !regenerating && (
          <div className="flex items-center space-x-3.5 print-hide">
            <button
              onClick={handleSendToClient}
              disabled={sendingToWhatsApp}
              className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all shadow-md font-sans"
            >
              {sendingToWhatsApp ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Send to Client on WhatsApp</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Client WhatsApp Rejection/Revision Feedback Banner */}
      {plan.status === "rejected" && clientFeedback && !regenerating && (
        <div className="p-5 rounded-2xl bg-amber-950/20 border border-amber-900/40 space-y-3.5 print-hide">
          <div className="flex items-center space-x-2 text-amber-400">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider font-sans">Client Revision Notes (WhatsApp)</span>
          </div>
          <p className="text-xs text-amber-200 leading-relaxed italic">
            &ldquo;{clientFeedback}&rdquo;
          </p>
          <button
            onClick={() => handleClientFeedbackRegenerate(clientFeedback)}
            disabled={regenerating}
            className="flex items-center space-x-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] cursor-pointer"
          >
            {regenerating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <span>Regenerate Plan with Client Feedback</span>
            )}
          </button>
        </div>
      )}

      {/* Reject notes form */}
      {showRejectForm && (
        <form onSubmit={handleRejectAndRegenerate} className="bg-slate-950/60 border border-red-900/30 rounded-2xl p-5 space-y-4 print-hide">
          <div className="flex items-center space-x-2 text-red-400">
            <MessageSquare className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Provide Rejection Notes for Regeneration</h3>
          </div>
          <textarea
            required
            rows={3}
            placeholder="e.g. Focus more on Dal Makhani ready meals, and decrease the budget ratio for brand awareness to 15%."
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            className="w-full bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 resize-none leading-relaxed"
          />
          <div className="flex items-center justify-end space-x-2 text-xs">
            <button
              type="button"
              onClick={() => setShowRejectForm(false)}
              className="py-1.5 px-3 border border-slate-800 hover:text-white rounded-lg text-[10px] font-semibold text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-1.5 px-3 bg-red-950/40 border border-red-900 text-red-300 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer"
            >
              Reject & Run AI Chain
            </button>
          </div>
        </form>
      )}

      {/* Main Grid: Strategy + Budget (Left) and Content Calendar (Right) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        
        {/* Left Side: Strategy & Budget */}
        <div className="md:col-span-1 space-y-6">
          
          {/* Strategy Summary */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4.5 print-card">
            <div className="border-b border-slate-900 pb-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Summary</span>
              <h3 className="text-xs font-extrabold text-white uppercase flex items-center">
                <FileText className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                Monthly Strategy Focus
              </h3>
            </div>

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              {plan.strategy_summary?.split("\n").map((line: string, idx: number) => {
                if (line.startsWith("Goals:")) {
                  return <p key={idx} className="font-bold text-white text-xs">{line}</p>;
                }
                if (line.startsWith("Central Focus:")) {
                  return <p key={idx} className="font-bold text-indigo-400 pt-1 text-xs">{line}</p>;
                }
                if (line.trim() === "") return <div key={idx} className="h-1" />;
                return <p key={idx} className="print-text">{line}</p>;
              })}
            </div>

            {/* Pillars list */}
            {plan.content_pillars && plan.content_pillars.length > 0 && (
              <div className="pt-4 border-t border-slate-900">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Content Pillars</span>
                <div className="flex flex-wrap gap-1.5">
                  {plan.content_pillars.map((pillar: string, idx: number) => (
                    <span
                      key={idx}
                      className="bg-indigo-950/30 border border-indigo-900/50 text-indigo-400 font-semibold px-2.5 py-1 rounded-lg text-[9px]"
                    >
                      {pillar}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Budget Splits */}
          {plan.budget_summary?.allocations && (
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4.5 print-card">
              <div className="border-b border-slate-900 pb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Budget</span>
                <h3 className="text-xs font-extrabold text-white uppercase flex items-center">
                  <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                  Media Spend Allocation
                </h3>
              </div>

              <div className="space-y-3.5">
                {plan.budget_summary.allocations.map((alloc: BudgetAllocation, idx: number) => (
                  <div key={idx} className="border-b border-slate-900/50 last:border-b-0 pb-3 last:pb-0 space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-200">{alloc.objective}</span>
                      <span className="font-mono font-semibold text-indigo-400">
                        {alloc.percentage}% (INR {alloc.amount?.toLocaleString("en-IN")})
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed font-medium print-text">{alloc.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Content Calendar cards */}
        <div className="md:col-span-2 space-y-4">
          
          <div className="flex items-center space-x-2 border-b border-slate-900 pb-3">
            <Calendar className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-extrabold text-white uppercase">Deliverables Calendar</h3>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {plan.content_calendar && plan.content_calendar.length > 0 ? (
              plan.content_calendar.map((slot: CalendarSlot, idx: number) => (
                <div key={idx} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4.5 space-y-3.5 relative overflow-hidden print-card">
                  <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-indigo-500" />
                  
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-300 font-mono font-bold flex items-center">
                      {new Date(slot.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                    </span>
                    
                    <div className="flex items-center space-x-2">
                      <span className="bg-slate-900 border border-slate-800 text-slate-400 font-bold px-2 py-0.5 rounded text-[8px] uppercase tracking-wider">
                        {slot.format}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono capitalize">{slot.platform}</span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-wide">Concept Details</span>
                      <h4 className="font-bold text-white text-xs mt-0.5 print-text">{slot.concept}</h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-900/30">
                      <div>
                        <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-wide">Intro Hook</span>
                        <p className="text-slate-300 text-[11px] leading-relaxed mt-0.5 print-text">{slot.hook}</p>
                      </div>
                      <div>
                        <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-wide">Call-To-Action</span>
                        <p className="text-slate-300 text-[11px] leading-relaxed mt-0.5 print-text">{slot.CTA}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 bg-slate-950/20 border border-slate-900 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium">No content calendar slots mapped for this plan.</p>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
