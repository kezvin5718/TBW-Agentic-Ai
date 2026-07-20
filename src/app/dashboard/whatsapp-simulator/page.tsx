"use client";

import React, { useState, useEffect } from "react";
import {
  Smartphone,
  Send,
  Loader2,
  MessageSquare
} from "lucide-react";

export default function WhatsAppSimulatorPage() {
  interface ClientSimulatorListItem {
    id: string;
    name: string;
    whatsapp_group_id: string | null;
    social_accounts: Record<string, unknown> | null;
  }

  interface SimulationResult {
    success: boolean;
    classification: string;
    matchedClient: string;
    routingTrace: string[];
    draftResponse: string | null;
  }

  const [clients, setClients] = useState<ClientSimulatorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [selectedClient, setSelectedClient] = useState("");
  const [customNumber, setCustomNumber] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [isVoiceNote, setIsVoiceNote] = useState(false);

  // Result traces
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        setLoading(true);
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        const { data } = await supabase
          .from("clients")
          .select("id, name, whatsapp_group_id, social_accounts")
          .order("name");

        setClients(data || []);
        if (data && data.length > 0) {
          setSelectedClient(data[0].id);
          const sa = data[0].social_accounts as Record<string, unknown> | null;
          setCustomNumber(data[0].whatsapp_group_id || (sa?.whatsapp as string) || "12345");
        }
      } catch (err: unknown) {
        console.error(err);
        setError("Failed to fetch clients configuration.");
      } finally {
        setLoading(false);
      }
    };

    fetchClients();
  }, []);

  const handleClientChange = (clientId: string) => {
    setSelectedClient(clientId);
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      const sa = client.social_accounts as Record<string, unknown> | null;
      setCustomNumber(client.whatsapp_group_id || (sa?.whatsapp as string) || "12345");
    }
  };

  const handleSimulateMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageBody.trim() || !customNumber.trim()) return;

    setSubmitting(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isSimulator: true,
          sender: customNumber,
          body: messageBody,
          type: isVoiceNote ? "audio" : "text",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to process message");
      }

      setResult(data);
      setMessageBody("");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong during simulation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
          <Smartphone className="w-4 h-4" />
          <span>Developer Tools</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">WhatsApp Webhook Simulator</h1>
        <p className="text-slate-400 text-xs mt-1">Simulate inbound WhatsApp replies to test LLM classifications and client approval loops.</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs">
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        
        {/* Simulator Input Box */}
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white mb-0.5">Send Simulated Message</h3>
            <p className="text-[10px] text-slate-500">Log client messages directly into database routing chains</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSimulateMessage} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Select Matched Client</label>
                  <select
                    value={selectedClient}
                    onChange={(e) => handleClientChange(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Sender phone Number</label>
                  <input
                    type="text"
                    required
                    value={customNumber}
                    onChange={(e) => setCustomNumber(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Voice Note Toggle */}
              <div className="flex items-center space-x-2 bg-slate-900/10 border border-slate-900 rounded-xl p-3">
                <input
                  type="checkbox"
                  id="isVoiceNote"
                  checked={isVoiceNote}
                  onChange={(e) => setIsVoiceNote(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="isVoiceNote" className="text-[10px] font-bold text-slate-300 cursor-pointer">
                  🎙 Send as Voice Note (audio attachment simulated payload)
                </label>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Message text {isVoiceNote && "(Voice Transcription)"}</label>
                <textarea
                  required
                  rows={4}
                  placeholder="e.g. Yes, the strategy plan looks perfect, go ahead!"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  className="w-full bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                />
              </div>

              {/* Quick suggestion tags */}
              <div className="space-y-1.5 pt-1">
                <span className="block text-[8px] font-bold text-slate-600 uppercase tracking-wider">Example Templates</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMessageBody("Perfect, the calendar looks amazing, I approve!")}
                    className="bg-indigo-950/20 hover:bg-indigo-900/20 text-indigo-400 border border-indigo-900/40 py-1 px-2 rounded-lg text-[9px] cursor-pointer"
                  >
                    Client Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageBody("No, this is completely wrong, change the recipe pillars.")}
                    className="bg-red-950/20 hover:bg-red-900/20 text-red-400 border border-red-900/40 py-1 px-2 rounded-lg text-[9px] cursor-pointer"
                  >
                    Change Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageBody("What is the current budget breakdown for conversions?")}
                    className="bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 py-1 px-2 rounded-lg text-[9px] cursor-pointer"
                  >
                    Question
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageBody("Why did my budget spike?! Stop running these campaigns immediately, I am extremely unhappy!")}
                    className="bg-amber-950/20 hover:bg-amber-900/20 text-amber-400 border border-amber-900/40 py-1 px-2 rounded-lg text-[9px] cursor-pointer"
                  >
                    Angry Escalation
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2.5 rounded-xl cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Simulate Message</span>
                    <Send className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Trace Output Console */}
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-6 space-y-5 h-full">
          <div>
            <h3 className="text-sm font-bold text-white mb-0.5">Execution Trace Console</h3>
            <p className="text-[10px] text-slate-500">Live router tracking and webhook status responses</p>
          </div>

          {result ? (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-4.5 space-y-3.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-500 uppercase font-bold tracking-wider">Classification</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    result.classification === "approval"
                      ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                      : result.classification === "rejection" || result.classification === "angry"
                      ? "bg-red-950/40 border border-red-900 text-red-400"
                      : "bg-slate-950 border border-slate-800 text-indigo-400"
                  }`}>
                    {result.classification}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-500 uppercase font-bold tracking-wider">Matched Client</span>
                  <span className="text-slate-200 font-bold">{result.matchedClient}</span>
                </div>
              </div>

              {/* Execution Steps Trace */}
              <div className="space-y-2">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Router execution logs</span>
                <div className="bg-slate-950 border border-slate-900 rounded-xl p-3.5 space-y-2 font-mono text-[9px] leading-relaxed text-slate-400">
                  {result.routingTrace && result.routingTrace.length > 0 ? (
                    result.routingTrace.map((log: string, i: number) => (
                      <div key={i} className="flex items-start space-x-2">
                        <span className="text-indigo-500">➜</span>
                        <span>{log}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 italic">No routing decisions triggered. Inbound message logged.</div>
                  )}
                </div>
              </div>

              {/* AI auto drafted response review */}
              {result.draftResponse && (
                <div className="bg-indigo-950/10 border border-indigo-900/30 rounded-xl p-4 space-y-2">
                  <div className="flex items-center space-x-1.5 text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>AI auto-drafted response</span>
                  </div>
                  <p className="text-[11px] text-indigo-200 leading-relaxed font-medium italic">
                    &ldquo;{result.draftResponse}&rdquo;
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="h-[250px] border border-dashed border-slate-900 rounded-xl flex flex-col items-center justify-center text-center p-6 space-y-2">
              <Smartphone className="w-8 h-8 text-slate-700 animate-pulse" />
              <div>
                <p className="text-xs text-slate-400 font-semibold">Idle. Waiting for trigger...</p>
                <p className="text-[9px] text-slate-600 mt-1 max-w-[200px]">Send a simulated client response from the left panel to execute webhook pipelines.</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
