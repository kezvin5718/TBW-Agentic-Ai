"use client";

import WaBridgePanels from "./WaBridgePanels";

import { useState, useEffect, useCallback, useRef } from "react";
import QRCode from "qrcode";
import { QrCode, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";

interface Status {
  status: string;
  qr: string | null;
  pairing_code: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
}

export default function WhatsAppReaderPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);
  const lastQr = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp-reader", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
        if (data.status?.qr && data.status.qr !== lastQr.current) {
          lastQr.current = data.status.qr;
          setQrImg(await QRCode.toDataURL(data.status.qr, { width: 260, margin: 1 }));
        }
        if (!data.status?.qr) { setQrImg(null); lastQr.current = null; }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000); // poll so the QR refreshes live
    return () => clearInterval(t);
  }, [load]);

  const relink = async () => {
    if (!window.confirm("Re-link WhatsApp? This logs out the current session and shows a fresh QR to scan with your dedicated number.")) return;
    setRelinking(true);
    try { await fetch("/api/whatsapp-reader", { method: "POST" }); }
    finally { setTimeout(() => setRelinking(false), 3000); }
  };

  const s = status?.status || "unknown";
  const connected = s === "connected";
  const online = status?.last_seen_at && Date.now() - new Date(status.last_seen_at).getTime() < 60000;

  const badge = connected
    ? { c: "bg-emerald-950/40 border-emerald-900 text-emerald-400", label: "Connected", Icon: CheckCircle2 }
    : s === "waiting_scan"
    ? { c: "bg-amber-950/40 border-amber-900 text-amber-400", label: "Waiting to link", Icon: QrCode }
    : s === "logged_out"
    ? { c: "bg-rose-950/40 border-rose-900 text-rose-400", label: "Logged out", Icon: AlertTriangle }
    : { c: "bg-slate-900 border-slate-800 text-slate-400", label: s, Icon: AlertTriangle };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Link2 className="w-6 h-6 text-emerald-400" /><span>WhatsApp Reader</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Link the dedicated WhatsApp number that reads your client groups. Scan the QR below from that phone — link or re-link anytime, right here.</p>
      </div>

      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-6 flex flex-col items-center space-y-4">
        <div className="flex items-center justify-between w-full">
          <span className={`text-xs font-black px-3 py-1 rounded-full border flex items-center space-x-1.5 ${badge.c}`}>
            <badge.Icon className="w-3.5 h-3.5" /><span>{badge.label}</span>
          </span>
          <span className={`text-[10px] font-bold flex items-center space-x-1.5 ${online ? "text-emerald-400" : "text-slate-600"}`}>
            <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span>{online ? "Reader online" : "Reader offline"}</span>
          </span>
        </div>

        {connected ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-white">Linked & reading your client groups.</p>
            <p className="text-[11px] text-slate-500 mt-1">Messages appear in the WhatsApp Task Bar.</p>
          </div>
        ) : qrImg ? (
          <>
            <img src={qrImg} alt="WhatsApp QR" className="rounded-xl border border-slate-800 bg-white p-2" />
            <p className="text-[11px] text-slate-400 text-center max-w-xs">On the <strong>dedicated phone</strong>: WhatsApp → Settings → Linked Devices → <strong>Link a device</strong> → scan this code.</p>
          </>
        ) : status?.pairing_code ? (
          <div className="py-6 text-center">
            <p className="text-[11px] text-slate-500 mb-2">Pairing code — enter on the dedicated phone (Link a device → Link with phone number):</p>
            <p className="text-3xl font-black tracking-widest text-white">{status.pairing_code}</p>
          </div>
        ) : (
          <div className="py-10 text-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-xs">Waiting for the reader… {online ? "generating a QR." : "start the reader container on the server."}</p>
          </div>
        )}

        <button onClick={relink} disabled={relinking} className="mt-2 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
          {relinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>{relinking ? "Re-linking…" : "Re-link / new number"}</span>
        </button>
      </div>

      <p className="text-[11px] text-slate-600 text-center">Uses the unofficial WhatsApp protocol on a dedicated number. It reads client groups and DMs, files media to Drive, and sends only what staff queue below. If the number is ever banned, click Re-link and scan with a new one.</p>

      <WaBridgePanels />
    </div>
  );
}
