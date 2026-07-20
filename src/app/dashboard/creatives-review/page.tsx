"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Check,
  X,
  Loader2,
  Calendar,
  Eye,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";

export default function FounderCreativesReviewPage() {
  interface CreativeItem {
    id: string;
    type: "video" | "image" | "carousel";
    caption: string;
    media_url: string;
    qc_status: string;
    founder_approval: string;
    client_approval: string;
    created_at: string;
    tasks: {
      deadline: string;
      metadata: Record<string, unknown> | null;
      monthly_plans: {
        month: string;
        clients: { name: string } | null;
      } | null;
    } | null;
    qc_report?: {
      passed: boolean;
      checks?: Array<{
        name: string;
        status: "passed" | "failed";
        details: string;
        cited_source_field: string;
      }>;
      suggested_corrections?: string;
    } | null;
  }

  const [creatives, setCreatives] = useState<CreativeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active card index in the review deck
  const [currentIndex, setCurrentIndex] = useState(0);

  // Rejection notes modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        setLoading(true);
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        // Query creatives where founder_approval = 'pending' and qc_status is passed or failed (passed is reviewable)
        const { data, error: err } = await supabase
          .from("creatives")
          .select(`
            *,
            tasks(
              *,
              monthly_plans(
                month,
                clients(name)
              )
            )
          `)
          .eq("founder_approval", "pending")
          .order("created_at", { ascending: true });

        if (err) throw err;
        setCreatives((data as unknown as CreativeItem[]) || []);
      } catch (err: unknown) {
        console.error(err);
        setError("Could not load approvals queue.");
      } finally {
        setLoading(false);
      }
    };
    fetchQueue();
  }, []);

  const handleDecision = async (decision: "approved" | "rejected", notes?: string) => {
    if (creatives.length === 0) return;
    
    const activeCreative = creatives[currentIndex];
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/creatives/${activeCreative.id}/founder-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Decision submittal failed");
      }

      // Remove from queue locally
      setCreatives((prev) => prev.filter((_, idx) => idx !== currentIndex));
      // Adjust index
      if (currentIndex >= creatives.length - 1) {
        setCurrentIndex(Math.max(0, creatives.length - 2));
      }
      setShowRejectModal(false);
      setRejectionNotes("");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  };

  const activeCreative = creatives[currentIndex];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4">
        <div>
          <div className="flex items-center space-x-1.5 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Creative Review Desk</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Founder approvals queue</h1>
        </div>
        
        {creatives.length > 0 && (
          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-3 py-1 rounded-full font-bold font-mono">
            {currentIndex + 1} of {creatives.length} pending
          </span>
        )}
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
      ) : creatives.length === 0 ? (
        <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-emerald-950/20 border border-emerald-900/40 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">All Caught Up!</h3>
          <p className="text-[10px] text-slate-500 max-w-xs mx-auto">No uploaded creatives are currently pending your approval. Everything is clean!</p>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Swipe Card container */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-3xl overflow-hidden shadow-2xl relative">
            
            {/* Brand details header */}
            <div className="p-4 border-b border-slate-900/60 bg-slate-900/10 flex justify-between items-center">
              <div>
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Client name</span>
                <h2 className="text-sm font-bold text-white leading-tight">
                  {activeCreative.tasks?.monthly_plans?.clients?.name}
                </h2>
              </div>

              <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                activeCreative.type === "video"
                  ? "bg-purple-950/40 border border-purple-900 text-purple-400"
                  : "bg-indigo-950/40 border border-indigo-900 text-indigo-400"
              }`}>
                {activeCreative.type}
              </span>
            </div>

            {/* Media preview panel */}
            <div className="aspect-[4/3] bg-slate-950 border-b border-slate-900 flex items-center justify-center relative overflow-hidden">
              {activeCreative.type === "video" ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-4">
                  {/* Since mediaURL is simulated, we display a mockup player */}
                  <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center mb-3">
                    <Eye className="w-8 h-8 text-indigo-500" />
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold">Simulated Video Player</span>
                  <a
                    href={activeCreative.media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[9px] text-indigo-400 hover:underline mt-1 flex items-center space-x-1"
                  >
                    <span>View raw media</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-4">
                  {/* Simulated Image preview */}
                  <img
                    src={activeCreative.media_url || "/fallback-media.jpg"}
                    alt="Creative Preview"
                    onError={(e) => {
                      // Fallback display if URL is not loading
                      (e.target as HTMLElement).style.display = "none";
                    }}
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-center p-4">
                    <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center mb-2">
                      <Eye className="w-6 h-6 text-slate-400" />
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">Image Preview Slot</span>
                    <span className="text-[8px] text-slate-600 font-mono break-all max-w-xs">{activeCreative.media_url}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Post date and format details */}
            <div className="p-5 space-y-4 text-xs">
              
              {/* Target Post Date */}
              <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>Planned Post Date:</span>
                <strong className="text-white">
                  {activeCreative.tasks?.deadline
                    ? new Date(activeCreative.tasks.deadline).toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })
                    : "N/A"}
                </strong>
              </div>

              {/* Draft Caption copy */}
              <div className="space-y-1.5 bg-slate-900/20 border border-slate-900 p-4 rounded-xl">
                <span className="text-[8px] text-slate-500 uppercase tracking-widest font-mono">Suggested Caption</span>
                <p className="text-[11px] text-slate-200 leading-relaxed italic">&ldquo;{activeCreative.caption}&rdquo;</p>
              </div>

              {/* Automatic QC pass details */}
              <div className="bg-slate-950 border border-slate-900 rounded-xl p-4.5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-900/60 pb-2">
                  <div className="flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">QC Auditor checks</span>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide ${
                    activeCreative.qc_status === "passed"
                      ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                      : "bg-red-950/40 border border-red-900/50 text-red-400"
                  }`}>
                    QC {activeCreative.qc_status}
                  </span>
                </div>

                {activeCreative.qc_report?.checks ? (
                  <div className="space-y-2.5 text-[10px]">
                    {activeCreative.qc_report.checks.map((chk, idx) => (
                      <div key={idx} className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-300 block">{chk.name}</span>
                          <span className="text-[8.5px] text-slate-500 italic block leading-normal">{chk.details}</span>
                          <span className="text-[8px] text-indigo-400 font-mono">source: {chk.cited_source_field}</span>
                        </div>
                        <span className={`font-mono text-[9px] font-bold ${chk.status === "passed" ? "text-emerald-400" : "text-red-400"}`}>
                          {chk.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-500 italic">No QC records.</span>
                )}

                {activeCreative.qc_report?.suggested_corrections && activeCreative.qc_status !== "passed" && (
                  <div className="pt-2 border-t border-slate-900/60 flex items-start space-x-2 text-[10px] text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <div className="space-y-0.5">
                      <span className="font-bold">Required Corrections:</span>
                      <p className="text-slate-400">{activeCreative.qc_report.suggested_corrections}</p>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Action buttons */}
            <div className="p-5 border-t border-slate-900/60 bg-slate-900/10 flex space-x-3 justify-between">
              
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                disabled={submitting}
                className="flex-1 flex items-center justify-center space-x-1.5 border border-red-900/30 hover:border-red-900 bg-red-950/10 hover:bg-red-950/20 text-red-400 font-bold py-3 rounded-2xl cursor-pointer text-xs"
              >
                <X className="w-4 h-4" />
                <span>Decline & Edit</span>
              </button>

              <button
                type="button"
                onClick={() => handleDecision("approved")}
                disabled={submitting}
                className="flex-1 flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl cursor-pointer text-xs shadow-lg"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Approve & Send</span>
                  </>
                )}
              </button>

            </div>

          </div>

          {/* Navigation deck pointers */}
          {creatives.length > 1 && (
            <div className="flex justify-between items-center text-[10px] text-slate-500 px-2">
              <button
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="hover:text-white disabled:opacity-30"
              >
                &larr; Previous Card
              </button>

              <button
                onClick={() => setCurrentIndex((prev) => Math.min(creatives.length - 1, prev + 1))}
                disabled={currentIndex === creatives.length - 1}
                className="hover:text-white disabled:opacity-30"
              >
                Next Card &rarr;
              </button>
            </div>
          )}

        </div>
      )}

      {/* Reject notes modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/75 z-55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-950 border border-slate-900 p-6 rounded-3xl space-y-4.5">
            <div>
              <h4 className="text-sm font-bold text-white mb-1">Decline Creative Draft</h4>
              <p className="text-[10px] text-slate-500 font-sans">Provide revision notes. This reopens the assignee&apos;s task and alerts them.</p>
            </div>

            <textarea
              rows={3}
              placeholder="e.g. Please change the pricing offer text to 15% discount as specified in brief."
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none placeholder:text-slate-650"
            />

            <div className="flex space-x-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectionNotes("");
                }}
                className="flex-1 bg-slate-900 hover:bg-slate-850 text-slate-400 py-2 rounded-xl text-[10px] font-bold"
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={() => handleDecision("rejected", rejectionNotes)}
                disabled={submitting}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-xl text-[10px] font-bold"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <span>Confirm Reject</span>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
