"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Clock,
  ArrowLeft,
  Loader2,
  AlertCircle,
  PlayCircle,
  Image as ImageIcon,
  CheckCircle2,
  FileSpreadsheet,
  Calendar
} from "lucide-react";

export default function CreativeTimelinePage() {
  const params = useParams();
  const creativeId = params.id as string;

  interface CreativeDetail {
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
      monthly_plans: {
        month: string;
        clients: { name: string } | null;
      } | null;
    } | null;
  }

  interface TimelineEventItem {
    id: string;
    event_type: string;
    status_from: string | null;
    status_to: string | null;
    actor_role: string;
    notes: string | null;
    created_at: string;
  }

  const [creative, setCreative] = useState<CreativeDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      // 1. Fetch creative details
      const { data: creativeData, error: creativeErr } = await supabase
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
        .eq("id", creativeId)
        .single();

      if (creativeErr) throw creativeErr;
      setCreative(creativeData as unknown as CreativeDetail);

      // 2. Fetch timeline events
      const { data: timelineData, error: timelineErr } = await supabase
        .from("creative_timeline")
        .select("*")
        .eq("creative_id", creativeId)
        .order("created_at", { ascending: true });

      if (timelineErr) throw timelineErr;
      setTimeline((timelineData as unknown as TimelineEventItem[]) || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to fetch creative timeline details.");
    } finally {
      setLoading(false);
    }
  }, [creativeId]);

  useEffect(() => {
    if (creativeId) {
      fetchDetails();
    }
  }, [creativeId, fetchDetails]);

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "creative_uploaded":
        return <ImageIcon className="w-4 h-4 text-indigo-400" />;
      case "qc_checked":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case "founder_review":
        return <Clock className="w-4 h-4 text-amber-400" />;
      case "whatsapp_dispatched":
        return <PlayCircle className="w-4 h-4 text-purple-400" />;
      case "client_review":
        return <CheckCircle2 className="w-4 h-4 text-teal-400" />;
      default:
        return <FileSpreadsheet className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      
      {/* Navigation */}
      <div className="flex items-center space-x-3 border-b border-slate-900 pb-4">
        <Link
          href="/dashboard/production"
          className="p-2 border border-slate-800 rounded-xl hover:border-slate-700 bg-slate-950/20 text-slate-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <div className="flex items-center space-x-1 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5" />
            <span>Creative Audit Trail</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Timeline & Review History</h1>
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
      ) : !creative ? (
        <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-12 text-center text-slate-500">
          Creative asset not found.
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Creative Profile Card */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3.5 text-xs">
            <div className="flex justify-between items-center border-b border-slate-900 pb-2.5">
              <div>
                <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-mono">Client name</span>
                <span className="text-sm font-bold text-white block">{creative.tasks?.monthly_plans?.clients?.name}</span>
              </div>

              <div className="flex space-x-2">
                <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                  creative.type === "video"
                    ? "bg-purple-950/40 border border-purple-900 text-purple-400"
                    : "bg-indigo-950/40 border border-indigo-900 text-indigo-400"
                }`}>
                  {creative.type}
                </span>

                <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                  creative.client_approval === "approved"
                    ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                    : creative.client_approval === "rejected"
                    ? "bg-red-950/40 border border-red-900/50 text-red-400"
                    : "bg-slate-900 border border-slate-800 text-slate-400"
                }`}>
                  Client: {creative.client_approval}
                </span>
              </div>
            </div>

            <div className="space-y-1 bg-slate-900/10 border border-slate-900/40 p-3 rounded-xl">
              <span className="text-[8px] text-slate-500 uppercase tracking-widest font-mono">Caption copy</span>
              <p className="text-[10px] text-slate-300 italic leading-relaxed">&ldquo;{creative.caption}&rdquo;</p>
            </div>

            <div className="flex justify-between items-center text-[10px] pt-1">
              <span className="text-slate-500 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-650" />
                <span>Uploaded:</span>
                <strong className="text-slate-300">{new Date(creative.created_at).toLocaleDateString()}</strong>
              </span>

              <a
                href={creative.media_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Open media link &rarr;
              </a>
            </div>

          </div>

          {/* Chronological Timeline */}
          <div className="space-y-6">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Transition Events</h3>

            {timeline.length === 0 ? (
              <div className="text-center py-6 text-slate-600 text-[10px] italic">
                No events recorded in lifecycle history.
              </div>
            ) : (
              <div className="relative border-l border-slate-900 ml-3.5 pl-6.5 space-y-6">
                {timeline.map((event) => (
                  <div key={event.id} className="relative group text-left">
                    
                    {/* Event Icon bullet */}
                    <div className="absolute -left-10 w-7 h-7 bg-slate-950 border border-slate-900 rounded-full flex items-center justify-center">
                      {getEventIcon(event.event_type)}
                    </div>

                    {/* Event Details */}
                    <div className="space-y-1.5 bg-slate-950/20 border border-slate-900 rounded-xl p-4 transition-all">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <span className="font-bold text-white text-[11px] uppercase tracking-wider">
                          {event.event_type.replace(/_/g, " ")}
                        </span>
                        
                        <span className="text-[9px] text-slate-500 font-mono">
                          {new Date(event.created_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>

                      {/* Status changes badge */}
                      {(event.status_from || event.status_to) && (
                        <div className="flex items-center space-x-1.5 text-[9px]">
                          <span className="text-slate-500 font-medium">State change:</span>
                          <span className="text-slate-400 bg-slate-900 border border-slate-850 px-1.5 py-0.5 rounded">
                            {event.status_from || "null"}
                          </span>
                          <span className="text-slate-600 font-bold">&rarr;</span>
                          <span className="text-indigo-400 bg-indigo-950/20 border border-indigo-900/40 px-1.5 py-0.5 rounded font-semibold">
                            {event.status_to || "null"}
                          </span>
                        </div>
                      )}

                      {/* Actor Badge */}
                      <div className="flex items-center space-x-1 text-[9.5px]">
                        <span className="text-slate-500">Actor role:</span>
                        <span className="text-slate-300 font-semibold uppercase font-mono">{event.actor_role}</span>
                      </div>

                      {/* Details / Notes */}
                      {event.notes && (
                        <p className="text-[10px] text-slate-400 leading-relaxed pt-1.5 border-t border-slate-900/60 font-sans italic">
                          &ldquo;{event.notes}&rdquo;
                        </p>
                      )}

                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
