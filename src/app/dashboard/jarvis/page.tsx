"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Cpu, ChevronRight, Loader2, Bot, User, MessageSquare, Mic } from "lucide-react";
import BronCore, { type CoreState } from "./BronCore";

interface ChatMessage {
  id?: string;
  sender: "user" | "jarvis";
  message: string;
  created_at?: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

type Mode = "chat" | "talk";

const MODE_KEY = "bron_mode";
const GREETING = "Hello boss — how can I help you?";
/** Listening at nobody for two minutes is a hot mic, not a conversation. */
const SLEEP_MS = 2 * 60 * 1000;

/**
 * Bron, in two modes.
 *
 * Chat is a keyboard: messages and an input, nothing that listens or speaks.
 * Talk is a conversation: the core greets you, listens, answers aloud, and
 * listens again — hands free until you stop it. Both read and write the same
 * history, so switching mode mid-conversation continues it rather than
 * starting again.
 */
export default function JarvisChatPage() {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingHistory, setFetchingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // The loop runs from callbacks that outlive the render they were made in, so
  // what it needs to know lives in refs rather than state.
  const talkActiveRef = useRef(false);
  const greetedRef = useRef(false);
  const onFinalRef = useRef<(text: string) => void>(() => {});
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the dial shows: hearing you beats working, working beats talking.
  const coreState: CoreState = isRecording ? "listening" : loading ? "thinking" : isSpeaking ? "speaking" : "idle";

  const STATE_LABEL: Record<CoreState, string> = {
    idle: "Standby", listening: "Listening", thinking: "Working", speaking: "Speaking",
  };

  // Last mode used, so the founder lands where he left off.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "talk" || saved === "chat") setMode(saved);
    } catch { /* a preference is not worth an error */ }
  }, []);
  // Skip the very first run: it fires with the default "chat" before the effect
  // above has restored the saved value, and would overwrite it.
  const firstPersist = useRef(true);
  useEffect(() => {
    if (firstPersist.current) { firstPersist.current = false; return; }
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  // The browser reports no voices until it has loaded them; touching the list
  // once here means the first spoken reply already has the good one available.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
  }, []);

  // ── The voice ─────────────────────────────────────────────────────────────

  /**
   * The browser's own voice — the free fallback when server TTS is unavailable,
   * and the whole voice if no key is ever configured.
   *
   * "en-IN" alone left the choice to the browser, which picks the flat default.
   * Macs ship far better British male voices (Daniel, Oliver, Arthur — the
   * Enhanced ones are a free download in System Settings), so ask for one by
   * name and only fall back to whatever exists. Slightly slower and lower than
   * default reads as composed rather than hurried.
   *
   * Resolves when the speaking stops, so the conversation loop knows when it is
   * its turn to listen again.
   */
  const speakWithBrowser = useCallback((cleanText: string): Promise<void> => {
    if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
    window.speechSynthesis.cancel();

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      // Best first: a named British male, then any British English voice.
      const wanted = ["Daniel", "Oliver", "Arthur", "Serena", "Google UK English Male"];
      const pick =
        wanted.map((n) => voices.find((v) => v.name.includes(n) && /en[-_]?GB/i.test(v.lang))).find(Boolean) ||
        voices.find((v) => /en[-_]?GB/i.test(v.lang)) ||
        voices.find((v) => /en[-_]?IN/i.test(v.lang));
      if (pick) utterance.voice = pick;
      utterance.lang = pick?.lang || "en-GB";
      utterance.rate = 0.94;
      utterance.pitch = 0.9;
      const done = () => { setIsSpeaking(false); resolve(); };
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  /** Server TTS first, browser voice as the fallback. Resolves when it stops. */
  const speakText = useCallback(async (text: string): Promise<void> => {
    // Remove markdown chars and emojis from speech output
    const cleanText = text.replace(/[*#`❌🎙]/g, "").replace(/\n+/g, " ");
    try {
      const res = await fetch("/api/jarvis/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
      });
      if (!res.ok) throw new Error("tts unavailable");
      const url = URL.createObjectURL(await res.blob());
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        const done = () => { setIsSpeaking(false); URL.revokeObjectURL(url); resolve(); };
        audio.onplay = () => setIsSpeaking(true);
        audio.onended = done;
        audio.onerror = done;
        // A cancelled clip must release the loop too, or Talk mode hangs on a
        // reply the founder chose to interrupt.
        audio.onpause = () => { if (!audio.ended) done(); };
        audio.play().catch(() => done());
      });
    } catch {
      await speakWithBrowser(cleanText);
    }
  }, [speakWithBrowser]);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setIsSpeaking(false);
  }, []);

  // ── The ear ───────────────────────────────────────────────────────────────

  const clearSleep = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    clearSleep();
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setIsRecording(false);
  }, [clearSleep]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || !talkActiveRef.current) return;
    setAsleep(false);
    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch { /* already running — the browser throws rather than no-ops */ }
    clearSleep();
    // Nothing said for two minutes is somebody who has walked away.
    sleepTimerRef.current = setTimeout(() => {
      stopListening();
      setAsleep(true);
    }, SLEEP_MS);
  }, [clearSleep, stopListening]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;
    if (!Ctor) { setSpeechSupported(false); return; }

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN"; // handle Indian English locale

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
      }
      if (!finalTranscript.trim()) return;
      // In Talk the utterance IS the message; in the fallback text row it fills
      // the box for the founder to check before sending.
      if (talkActiveRef.current) onFinalRef.current(finalTranscript.trim());
      else setInputValue((prev) => prev + (prev ? " " : "") + finalTranscript.trim());
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", e);
      setIsRecording(false);
    };
    rec.onend = () => setIsRecording(false);

    recognitionRef.current = rec;
  }, []);

  // ── History and the shared submit path ────────────────────────────────────

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch("/api/jarvis/chat");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.history) setMessages(data.history);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      } finally {
        setFetchingHistory(false);
      }
    }
    fetchHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** The one way a message reaches Bron. Returns the reply so Talk can speak it. */
  const handleSendMessage = useCallback(async (textToSend?: string): Promise<string | null> => {
    const text = (textToSend || inputValue).trim();
    if (!text) return null;
    if (!textToSend) setInputValue("");

    setMessages((prev) => [...prev, { sender: "user", message: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reply) {
          setMessages((prev) => [...prev, { sender: "jarvis", message: data.reply }]);
          return data.reply as string;
        }
        setMessages((prev) => [...prev, { sender: "jarvis", message: "Error: No reply content returned." }]);
        return null;
      }
      setMessages((prev) => [...prev, { sender: "jarvis", message: "Failed to connect to Bron. Verify your credentials." }]);
      return null;
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { sender: "jarvis", message: "Network connection error." }]);
      return null;
    } finally {
      setLoading(false);
    }
  }, [inputValue]);

  // ── The conversation loop ─────────────────────────────────────────────────

  // One turn: hear it, answer it, say the answer, then listen again. Every step
  // checks the loop is still wanted, so leaving Talk mid-turn stops it cleanly.
  useEffect(() => {
    onFinalRef.current = async (text: string) => {
      if (!talkActiveRef.current) return;
      stopListening();
      const reply = await handleSendMessage(text);
      if (!talkActiveRef.current) return;
      // In Talk the reply is always spoken — that is what Talk means.
      if (reply) await speakText(reply);
      if (talkActiveRef.current) startListening();
    };
  }, [handleSendMessage, speakText, startListening, stopListening]);

  useEffect(() => {
    if (mode !== "talk") {
      // Nothing keeps listening once you have left the room.
      talkActiveRef.current = false;
      stopListening();
      cancelSpeech();
      setAsleep(false);
      return;
    }
    talkActiveRef.current = true;
    if (greetedRef.current) return;
    greetedRef.current = true;
    (async () => {
      // Spoken, never written: the greeting is a doorbell, not a message, and
      // sending it to the model would put it in the history for good.
      await speakText(GREETING);
      if (talkActiveRef.current) startListening();
    })();
  }, [mode, speakText, startListening, stopListening, cancelSpeech]);

  // Leaving the page entirely must not leave a microphone open.
  useEffect(() => () => {
    talkActiveRef.current = false;
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    audioRef.current?.pause();
  }, []);

  /**
   * The core is the only control in Talk mode.
   *
   * Speaking → stop talking and listen (interrupting is how people converse).
   * Listening → stop, and stay stopped. Idle → listen. Working → wait.
   */
  const tapCore = () => {
    if (isSpeaking) { cancelSpeech(); startListening(); return; }
    if (isRecording) { stopListening(); return; }
    if (loading) return;
    startListening();
  };

  const suggestions = [
    "Do I have any pending approvals?",
    "Show me overdue tasks",
    "Give me the lead pipeline summary",
    "What is the status of SWAD?",
    "Get campaign metrics for SWAD",
  ];

  const transcript = (compact: boolean) => (
    <div className={`space-y-3 ${compact ? "" : "space-y-4"}`}>
      {messages.map((msg, index) => (
        <div key={index} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
          <div className={`flex items-start space-x-2 max-w-[85%] ${msg.sender === "user" ? "flex-row-reverse space-x-reverse" : "flex-row"}`}>
            <div className={`p-1.5 rounded-lg text-white ${msg.sender === "user" ? "bg-slate-800" : "bg-indigo-950/40 border border-indigo-500/20"}`}>
              {msg.sender === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-indigo-400" />}
            </div>
            <div className={`p-3.5 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap ${
              msg.sender === "user"
                ? "bg-indigo-650 text-white rounded-tr-none font-medium shadow-md shadow-indigo-950/20"
                : "bg-slate-900/60 border border-slate-900 text-slate-200 rounded-tl-none"
            }`}>
              {msg.message}
            </div>
          </div>
        </div>
      ))}
      {loading && (
        <div className="flex justify-start items-center space-x-2 text-xs text-slate-500 font-mono pl-8">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Bron is thinking...</span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-130px)] max-w-3xl mx-auto w-full">
      {/* Mode selector */}
      <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider w-fit">
        {([
          { key: "chat" as Mode, label: "💬 Chat", icon: MessageSquare },
          { key: "talk" as Mode, label: "🎙️ Talk", icon: Mic },
        ]).map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${
              mode === m.key ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col flex-1 min-h-0 bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden backdrop-blur-md">
        {/* Header Info */}
        <div className="bg-slate-900/35 border-b border-slate-900 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-500/10 p-2 rounded-xl border border-indigo-500/20">
              <Cpu className="w-5 h-5 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white flex items-center space-x-1.5">
                <span>Bron Agent Console</span>
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-mono font-bold">Founder Mode</span>
              </h2>
              <p className="text-[10px] text-slate-500">Autonomous systems controller</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-emerald-400 font-mono bg-emerald-950/20 px-2.5 py-1 rounded-full border border-emerald-500/15">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
            <span>CONNECTED</span>
          </div>
        </div>

        {mode === "talk" ? (
          /* ── TALK: the core is the interface ─────────────────────────────── */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex flex-col items-center gap-2 pt-6 pb-4 shrink-0">
              <button onClick={tapCore} title="Tap the core" className="cursor-pointer">
                <BronCore state={coreState} size={220} />
              </button>
              <p className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase text-indigo-400">{STATE_LABEL[coreState]}</p>
              <p className="text-[10px] text-slate-600 text-center px-6">
                {!speechSupported ? "Voice input needs Chrome or a phone browser"
                  : asleep ? "Tap the core to talk"
                  : coreState === "listening" ? "Speak — the ring follows your voice"
                  : coreState === "thinking" ? "Reading the database"
                  : coreState === "speaking" ? "Replying aloud — tap the core to cut in"
                  : "Tap the core to talk"}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4 min-h-0 scrollbar-thin border-t border-slate-900/60 pt-4">
              {messages.length === 0
                ? <p className="text-[11px] text-slate-600 text-center py-6">Nothing said yet. The transcript appears here as you talk.</p>
                : transcript(true)}
            </div>

            {/* Without the Web Speech API there is no loop — so the keyboard stays. */}
            {!speechSupported && (
              <div className="p-4 border-t border-slate-900 bg-slate-900/10">
                <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-center space-x-2">
                  <input
                    type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={loading}
                    placeholder="Type instruction…"
                    className="flex-1 bg-slate-950/60 border border-slate-900 text-xs rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                  />
                  <button type="submit" disabled={loading || !inputValue.trim()}
                    className="bg-indigo-600 hover:bg-indigo-550 text-white p-3 rounded-xl disabled:opacity-30 flex items-center justify-center cursor-pointer shrink-0">
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          /* ── CHAT: keyboard only, nothing listens or speaks ──────────────── */
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0 scrollbar-thin">
              {fetchingHistory ? (
                <div className="flex flex-col items-center justify-center h-full space-y-3">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                  <p className="text-xs text-slate-500 font-mono">Decrypting console logs...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto space-y-4">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Founder-only assistant. Ask for metrics, search client briefs, draft copy, or approve creatives.
                    Switch to <span className="text-indigo-400 font-semibold">🎙️ Talk</span> to do it by voice.
                  </p>
                </div>
              ) : transcript(false)}
            </div>

            {!loading && messages.length < 5 && (
              <div className="px-4 pb-2 pt-2 flex flex-wrap gap-2 overflow-x-auto scrollbar-none border-t border-slate-900 bg-slate-950/10">
                {suggestions.map((s, idx) => (
                  <button key={idx} onClick={() => handleSendMessage(s)}
                    className="text-[10px] text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-850 px-3 py-1.5 rounded-full transition-all duration-200 flex items-center space-x-1">
                    <span>{s}</span>
                    <ChevronRight className="w-3 h-3 text-indigo-400" />
                  </button>
                ))}
              </div>
            )}

            <div className="p-4 border-t border-slate-900 bg-slate-900/10">
              <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-center space-x-2">
                <input
                  type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={loading}
                  placeholder={loading ? "Bron is executing tools..." : "Type instruction…"}
                  className="flex-1 bg-slate-950/60 border border-slate-900 text-xs rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-50"
                />
                <button type="submit" disabled={loading || !inputValue.trim()}
                  className="bg-indigo-600 hover:bg-indigo-550 text-white p-3 rounded-xl transition-colors disabled:opacity-30 flex items-center justify-center cursor-pointer shrink-0">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
