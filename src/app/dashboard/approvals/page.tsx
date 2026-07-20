"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  CheckSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Send,
  Smartphone,
  HelpCircle
} from "lucide-react";

export default function ApprovalsPage() {
  interface ClientApprovalItem {
    id: string;
    client_id: string;
    entity_type: string;
    entity_id: string;
    approver_role: string;
    channel: string;
    decision: string;
    feedback_text: string | null;
    created_at: string;
    clients: { name: string } | null;
  }

  interface WhatsAppMessageListItem {
    id: string;
    client_id: string | null;
    sender_number: string;
    message_body: string | null;
    message_type: string;
    direction: string;
    classification: string | null;
    reply_draft: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    clients: { name: string } | null;
  }

  const [pendingApprovals, setPendingApprovals] = useState<ClientApprovalItem[]>([]);
  const [unansweredQuestions, setUnansweredQuestions] = useState<WhatsAppMessageListItem[]>([]);
  const [recentMessages, setRecentMessages] = useState<WhatsAppMessageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft overrides states
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draftOverrideText, setDraftOverrideText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const fetchApprovalsData = useCallback(async () => {
    try {
      setLoading(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      // 1. Fetch pending approvals (decision = 'pending')
      const { data: approvalsData } = await supabase
        .from("approvals")
        .select("*, clients(name)")
        .eq("decision", "pending")
        .order("created_at", { ascending: false });

      // 2. Fetch unanswered questions (reply_draft is not null)
      const { data: questionsData } = await supabase
        .from("whatsapp_messages")
        .select("*, clients(name)")
        .not("reply_draft", "is", null)
        .order("created_at", { ascending: false });

      // 3. Fetch recent WhatsApp messages log
      const { data: messagesData } = await supabase
        .from("whatsapp_messages")
        .select("*, clients(name)")
        .order("created_at", { ascending: false })
        .limit(20);

      setPendingApprovals((approvalsData as unknown as ClientApprovalItem[]) || []);
      setUnansweredQuestions((questionsData as unknown as WhatsAppMessageListItem[]) || []);
      setRecentMessages((messagesData as unknown as WhatsAppMessageListItem[]) || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to load approvals details. Check your DB connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovalsData();
  }, [fetchApprovalsData]);

  // Handle manual dashboard decision (Approve/Reject)
  const handleDecision = async (approvalId: string, decision: "internal_review" | "rejected") => {
    setError(null);
    try {
      const response = await fetch(`/api/planning/${approvalId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: decision,
          notes: `Manual decision recorded by Founder from approvals console.`,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update decision");
      }

      await fetchApprovalsData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  // Select a question to edit its draft response
  const handleSelectQuestion = (msgId: string, currentDraft: string) => {
    setEditingMessageId(msgId);
    setDraftOverrideText(currentDraft);
  };

  // Submit response dispatch API
  const handleSendResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMessageId || !draftOverrideText.trim()) return;

    setSendingReply(true);
    setError(null);

    try {
      const response = await fetch(`/api/approvals/${editingMessageId}/send-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyText: draftOverrideText,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to dispatch reply");
      }

      setEditingMessageId(null);
      setDraftOverrideText("");
      await fetchApprovalsData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to send WhatsApp message.");
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
            <CheckSquare className="w-4 h-4" />
            <span>Operational Safeguards</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-sans">Approvals Console</h1>
          <p className="text-slate-400 text-xs mt-1">Review pending client templates, chat histories, and dispatch AI drafted replies.</p>
        </div>

        <Link
          href="/dashboard/whatsapp-simulator"
          className="flex items-center justify-center space-x-1.5 border border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-300 py-2 px-4 rounded-xl text-xs font-semibold"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Open Webhook Simulator</span>
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-2">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <span className="text-[10px] text-slate-500 font-medium">Loading Approvals Dashboard...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          
          {/* Left Column: Pending Approvals & Question Reply box */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Pending Approvals Card list */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-0.5">Pending Client Approvals</h3>
                <p className="text-[10px] text-slate-500">Approvals currently dispatched to client WhatsApp threads</p>
              </div>

              {pendingApprovals.length === 0 ? (
                <div className="h-[120px] border border-dashed border-slate-900 rounded-xl flex flex-col items-center justify-center text-center p-4">
                  <CheckCircle2 className="w-6 h-6 text-slate-700" />
                  <p className="text-[10px] text-slate-500 mt-1.5 font-medium">No pending client approvals registered.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3.5 text-xs">
                  {pendingApprovals.map((app) => (
                    <div key={app.id} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4 space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200 text-xs">{app.clients?.name}</span>
                        <span className="text-[8px] font-bold text-indigo-400 bg-indigo-950/40 border border-indigo-900 px-2 py-0.5 rounded uppercase font-mono">
                          {app.entity_type}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 leading-relaxed">
                        {app.feedback_text}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-900/40 text-[10px] text-slate-500">
                        <span className="font-mono">
                          {new Date(app.created_at).toLocaleDateString("en-IN", { hour: "numeric", minute: "numeric" })}
                        </span>
                        
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleDecision(app.entity_id, "rejected")}
                            className="flex items-center space-x-0.5 text-red-500 hover:text-red-400 font-bold"
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Reject</span>
                          </button>
                          <button
                            onClick={() => handleDecision(app.entity_id, "internal_review")}
                            className="flex items-center space-x-0.5 text-emerald-500 hover:text-emerald-400 font-bold"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Approve</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Questions review & reply dispatcher */}
            {unansweredQuestions.length > 0 && (
              <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white mb-0.5">Review Client Questions</h3>
                  <p className="text-[10px] text-slate-500">Select a question to inspect and approve AI generated answer drafts</p>
                </div>

                <div className="grid grid-cols-1 gap-3.5 text-xs">
                  {unansweredQuestions.map((q) => (
                    <div
                      key={q.id}
                      onClick={() => handleSelectQuestion(q.id, q.reply_draft || "")}
                      className={`p-4 rounded-xl border transition-all cursor-pointer text-left space-y-2.5 ${
                        editingMessageId === q.id
                          ? "bg-indigo-950/10 border-indigo-500/50"
                          : "bg-slate-900/20 border-slate-900 hover:border-slate-800"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-slate-300">{q.clients?.name || "Unknown"} ({q.sender_number})</span>
                        <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <p className="text-[11px] text-slate-400 italic">&ldquo;{q.message_body}&rdquo;</p>
                    </div>
                  ))}
                </div>

                {editingMessageId && (
                  <form onSubmit={handleSendResponse} className="bg-slate-950 border border-slate-900 rounded-xl p-4.5 space-y-4 text-xs">
                    <div className="flex items-center space-x-1.5 text-indigo-400 font-bold text-[10px] uppercase tracking-wider">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Review Auto Draft reply</span>
                    </div>

                    <textarea
                      required
                      rows={3}
                      value={draftOverrideText}
                      onChange={(e) => setDraftOverrideText(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed text-[11px]"
                    />

                    <div className="flex justify-between items-center">
                      <button
                        type="button"
                        onClick={() => setEditingMessageId(null)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={sendingReply}
                        className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] cursor-pointer"
                      >
                        {sendingReply ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <span>Send Draft</span>
                            <Send className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

          </div>

          {/* Right Column: Chat History & Classification Alerts */}
          <div className="md:col-span-1 space-y-6">
            
            {/* Recent Message Feed Card */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-5 h-[500px] flex flex-col">
              <div>
                <h3 className="text-sm font-bold text-white mb-0.5 font-sans">Recent WhatsApp Logs</h3>
                <p className="text-[10px] text-slate-500">Live feed of inbound and outbound classifications</p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
                {recentMessages.map((msg) => (
                  <div key={msg.id} className="bg-slate-900/10 border border-slate-900/60 rounded-xl p-3.5 space-y-2 text-[10px] relative">
                    
                    {/* Directional Tag */}
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-300 font-sans">
                        {msg.clients?.name || msg.sender_number}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase font-mono tracking-wider ${
                        msg.direction === "inbound"
                          ? "bg-slate-900 text-slate-400"
                          : "bg-indigo-950/50 border border-indigo-900 text-indigo-400"
                      }`}>
                        {msg.direction}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-normal">{msg.message_body}</p>

                    {/* Classification details */}
                    {msg.direction === "inbound" && (
                      <div className="flex items-center justify-between pt-1 text-[8px]">
                        <span className={`font-extrabold uppercase tracking-widest ${
                          msg.classification === "angry"
                            ? "text-red-500 font-bold"
                            : msg.classification === "approval"
                            ? "text-emerald-400"
                            : "text-indigo-400"
                        }`}>
                          {msg.classification === "angry" ? "⚠️ angry alert" : msg.classification}
                        </span>
                        
                        <span className="text-slate-600 font-mono">
                          {new Date(msg.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
