"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { UserCircle, Loader2, Camera, Trash2, CheckCircle2, AlertTriangle, Shield, Briefcase } from "lucide-react";
import Avatar from "../Avatar";
import { fmtISTDate } from "@/lib/time";

interface Profile {
  id: string;
  name: string | null;
  email?: string;
  role: string;
  designation: string | null;
  phone: string | null;
  about: string | null;
  avatar_url: string | null;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = { founder: "Founder", employee: "Team", client: "Client" };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [about, setAbout] = useState("");

  const fill = (p: Profile) => {
    setProfile(p);
    setName(p.name || "");
    setDesignation(p.designation || "");
    setPhone(p.phone || "");
    setAbout(p.about || "");
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) fill(data.profile);
      else setNotice({ ok: false, text: data.error || "Could not load your profile" });
    } catch {
      setNotice({ ok: false, text: "Could not load your profile" });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, designation, phone, about }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      fill(data.profile);
      setNotice({ ok: true, text: "Profile saved — your team will see this next to your name." });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/profile", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setProfile((p) => (p ? { ...p, avatar_url: data.avatar_url } : p));
      setNotice({ ok: true, text: "Photo updated ✅" });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    if (!window.confirm("Remove your photo? Your initials will be shown instead.")) return;
    setUploading(true);
    try {
      await fetch("/api/profile", { method: "DELETE" });
      setProfile((p) => (p ? { ...p, avatar_url: null } : p));
      setNotice({ ok: true, text: "Photo removed." });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const RoleIcon = profile?.role === "founder" ? Shield : Briefcase;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <UserCircle className="w-6 h-6 text-indigo-400" />
          <span>My Profile</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Your photo and details appear next to your name everywhere in the portal — uploads, tasks and the team list.</p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-center space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Photo */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 flex items-center gap-5 flex-wrap">
        <div className="relative">
          <Avatar name={name || profile?.name} url={profile?.avatar_url} size={96} rounded="rounded-2xl" />
          {uploading && (
            <span className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            </span>
          )}
        </div>
        <div className="space-y-2 min-w-[200px]">
          <p className="text-sm font-bold text-white">Profile photo</p>
          <p className="text-[11px] text-slate-500 max-w-xs">A clear headshot works best. Square images look right everywhere. JPG or PNG, up to 5 MB.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{profile?.avatar_url ? "Change photo" : "Upload photo"}</span>
            </button>
            {profile?.avatar_url && (
              <button
                type="button"
                disabled={uploading}
                onClick={removePhoto}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-400 hover:text-rose-400 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }}
          />
        </div>
      </div>

      {/* Details */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white">Your details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kezvin Bodhani"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Designation</label>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Video Editor, Graphic Designer"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Contact number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +91 98765 43210"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Email</label>
            <input value={profile?.email || ""} disabled title="Your email is your login — a founder must change it"
              className="w-full bg-slate-900/50 border border-slate-900 rounded-xl px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">About <span className="text-slate-600 normal-case font-medium">— what you work on</span></label>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} placeholder="e.g. Handles reels and short-form edits for the jewellery clients."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <RoleIcon className="w-3.5 h-3.5" />
            <span>{ROLE_LABEL[profile?.role || ""] || profile?.role} · joined {fmtISTDate(profile?.created_at)}</span>
          </div>
          <button onClick={save} disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50">
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
        <p className="text-[10px] text-slate-600">Your role and section access are set by a founder — ask them if something needs changing.</p>
      </div>
    </div>
  );
}
