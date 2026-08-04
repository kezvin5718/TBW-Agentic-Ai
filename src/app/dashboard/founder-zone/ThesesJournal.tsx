"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  BookOpenText,
  ScrollText,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  Sunrise,
  Bot,
  StickyNote,
} from "lucide-react";

export interface Thesis {
  id: string;
  ticker: string;
  name: string;
  thesis: string;
  wrong_if: string;
  checkpoints: string;
  status: string;
  updated_at: string;
}

interface JournalEntry {
  id: string;
  created_at: string;
  entry_type: string;
  title: string;
  content: string;
}

const STATUS_STYLES: Record<string, string> = {
  on_thesis: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
  damaged: "bg-amber-950/40 text-amber-400 border-amber-800/50",
  broken: "bg-red-950/40 text-red-400 border-red-800/50",
};

const ENTRY_ICONS: Record<string, React.ElementType> = {
  brief: Sunrise,
  desk: Bot,
  note: StickyNote,
  decision: ScrollText,
};

export default function ThesesJournal() {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Thesis editor modal
  const [editing, setEditing] = useState<Partial<Thesis> | null>(null);

  // Manual journal note
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  // Expanded journal entry
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tRes, jRes] = await Promise.all([
        fetch("/api/founder/theses"),
        fetch("/api/founder/journal"),
      ]);
      if (tRes.ok) setTheses((await tRes.json()).theses || []);
      if (jRes.ok) setEntries((await jRes.json()).entries || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveThesis = async () => {
    if (!editing?.ticker?.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/founder/theses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteThesis = async (ticker: string) => {
    if (!window.confirm(`Delete the thesis for ${ticker}?`)) return;
    await fetch("/api/founder/theses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });
    await load();
  };

  const saveNote = async () => {
    if (!noteContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/founder/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_type: "decision", title: noteTitle, content: noteContent }),
      });
      if (res.ok) {
        setNoteOpen(false);
        setNoteTitle("");
        setNoteContent("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs">Loading theses & journal…</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ── Theses ─────────────────────────────────────────── */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookOpenText className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white">Written Theses</h2>
          </div>
          <button
            onClick={() => setEditing({ status: "on_thesis" })}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>
        <div className="divide-y divide-slate-900/50 max-h-[28rem] overflow-y-auto">
          {theses.length === 0 && (
            <p className="p-5 text-xs text-slate-600">
              No theses yet. If you can&apos;t write the thesis, you don&apos;t have one — start
              with your six holdings.
            </p>
          )}
          {theses.map((t) => (
            <div key={t.id} className="px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <p className="text-sm font-bold text-slate-200">{t.name || t.ticker}</p>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                      STATUS_STYLES[t.status] || STATUS_STYLES.on_thesis
                    }`}
                  >
                    {t.status.replace("_", " ").toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setEditing(t)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-900/60"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteThesis(t.ticker)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/20"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {t.thesis && (
                <p className="text-xs text-slate-400 leading-snug">{t.thesis}</p>
              )}
              {t.wrong_if && (
                <p className="text-[11px] text-amber-300/80 leading-snug">
                  <span className="font-bold">I&apos;m wrong if:</span> {t.wrong_if}
                </p>
              )}
              {t.checkpoints && (
                <p className="text-[11px] text-slate-500 leading-snug">
                  <span className="font-bold">Checkpoints:</span> {t.checkpoints}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Journal ────────────────────────────────────────── */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ScrollText className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Journal</h2>
            <span className="text-[10px] text-slate-600">briefs & desk runs auto-filed</span>
          </div>
          <button
            onClick={() => setNoteOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Decision</span>
          </button>
        </div>
        <div className="divide-y divide-slate-900/50 max-h-[28rem] overflow-y-auto">
          {entries.length === 0 && (
            <p className="p-5 text-xs text-slate-600">
              Empty. The first Morning Brief (8:45 AM weekdays) or desk run will appear here.
            </p>
          )}
          {entries.map((e) => {
            const Icon = ENTRY_ICONS[e.entry_type] || StickyNote;
            const expanded = expandedId === e.id;
            return (
              <button
                key={e.id}
                onClick={() => setExpandedId(expanded ? null : e.id)}
                className="w-full text-left px-5 py-3 hover:bg-slate-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <p className="text-xs font-semibold text-slate-300 truncate">
                      {e.title || e.entry_type}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-600 shrink-0 ml-3">
                    {new Date(e.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                <p
                  className={`text-[11px] text-slate-500 mt-1 leading-snug whitespace-pre-wrap ${
                    expanded ? "" : "line-clamp-2"
                  }`}
                >
                  {e.content}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Thesis editor modal ───────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editing.id ? "Edit Thesis" : "New Thesis"}
              </h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            {[
              { key: "ticker", label: "Ticker *", ph: "e.g. SUZLON.NS" },
              { key: "name", label: "Company name", ph: "e.g. Suzlon Energy" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  {f.label}
                </label>
                <input
                  value={(editing[f.key as keyof Thesis] as string) || ""}
                  onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.ph}
                  className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-800/60"
                />
              </div>
            ))}
            {[
              { key: "thesis", label: "Thesis — why I own it (your words)", rows: 3 },
              { key: "wrong_if", label: "I'm wrong if…", rows: 2 },
              { key: "checkpoints", label: "Checkpoints (earnings dates, events)", rows: 2 },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  {f.label}
                </label>
                <textarea
                  value={(editing[f.key as keyof Thesis] as string) || ""}
                  onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.value }))}
                  rows={f.rows}
                  className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-800/60 resize-y"
                />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                value={editing.status || "on_thesis"}
                onChange={(e) => setEditing((v) => ({ ...v, status: e.target.value }))}
                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none"
              >
                <option value="on_thesis">On thesis</option>
                <option value="damaged">Damaged</option>
                <option value="broken">Broken</option>
              </select>
            </div>
            <button
              onClick={saveThesis}
              disabled={saving || !editing.ticker?.trim()}
              className="w-full py-2.5 rounded-lg bg-amber-950/40 border border-amber-800/50 text-sm font-semibold text-amber-300 hover:text-white hover:border-amber-700 transition-all disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save Thesis"}
            </button>
          </div>
        </div>
      )}

      {/* ── Manual decision note modal ────────────────────── */}
      {noteOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Log a Decision</h3>
              <button onClick={() => setNoteOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Title (e.g. Trimmed Suzlon 25%)"
              className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-800/60"
            />
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="What you decided and WHY, at the time — this is the compounding that matters."
              rows={4}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-800/60 resize-y"
            />
            <button
              onClick={saveNote}
              disabled={saving || !noteContent.trim()}
              className="w-full py-2.5 rounded-lg bg-cyan-950/40 border border-cyan-800/50 text-sm font-semibold text-cyan-300 hover:text-white hover:border-cyan-700 transition-all disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save to Journal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
