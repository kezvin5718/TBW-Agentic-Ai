"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Send, 
  Cpu, 
  ChevronRight, 
  Loader2, 
  Bot,
  User,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from "lucide-react";

interface ChatMessage {
  id?: string;
  sender: "user" | "jarvis";
  message: string;
  created_at?: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: {
    transcript: string;
  };
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

export default function JarvisChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingHistory, setFetchingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Browser Speech-to-Text & Text-to-Speech States

  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Initialize Web Speech API Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition || (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-IN"; // handle Indian English locale

        rec.onresult = (event: SpeechRecognitionEvent) => {
          let finalTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            }
          }
          if (finalTranscript) {
            setInputValue((prev) => prev + (prev ? " " : "") + finalTranscript.trim());
          }
        };

        rec.onerror = (e: SpeechRecognitionErrorEvent) => {
          console.error("Speech recognition error:", e);
          setIsRecording(false);
        };

        rec.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = rec;
      }
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Web Speech API (Speech Recognition) is not supported in this browser. Try Google Chrome or Safari.");
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }
  };

  const speakText = (text: string) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      // Remove markdown chars and emojis from speech output
      const cleanText = text.replace(/[*#`❌🎙]/g, "").replace(/\n+/g, " ");
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "en-IN"; // Indian English voice

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleSpeakReplies = () => {
    const newVal = !speakReplies;
    setSpeakReplies(newVal);
    if (!newVal && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  // Suggestion chips for easy mobile taps
  const suggestions = [
    "Do I have any pending approvals?",
    "Show me overdue tasks",
    "Give me the lead pipeline summary",
    "What is the status of SWAD?",
    "Get campaign metrics for SWAD"
  ];

  // Fetch history on mount
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch("/api/jarvis/chat");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.history) {
            setMessages(data.history);
          }
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      } finally {
        setFetchingHistory(false);
      }
    }
    fetchHistory();
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text) return;

    if (!textToSend) {
      setInputValue("");
    }

    // Add user message locally
    const userMsg: ChatMessage = { sender: "user", message: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reply) {
          setMessages((prev) => [...prev, { sender: "jarvis", message: data.reply }]);
          if (speakReplies) {
            speakText(data.reply);
          }
        } else {
          setMessages((prev) => [...prev, { sender: "jarvis", message: "Error: No reply content returned." }]);
        }
      } else {
        setMessages((prev) => [...prev, { sender: "jarvis", message: "Failed to connect to Bron. Verify your credentials." }]);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { sender: "jarvis", message: "Network connection error." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] max-w-2xl mx-auto bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden backdrop-blur-md">
      
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

      {/* Messages viewport */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0 scrollbar-thin">
        {fetchingHistory ? (
          <div className="flex flex-col items-center justify-center h-full space-y-3">
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-500 font-mono">Decrypting console logs...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto space-y-4">
            <Bot className="w-10 h-10 text-indigo-400" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Bron is online</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Founder-only assistant. Ask for metrics, search client briefs, draft copy, or approve creatives.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
              >
                <div className={`flex items-start space-x-2 max-w-[85%] ${msg.sender === "user" ? "flex-row-reverse space-x-reverse" : "flex-row"}`}>
                  
                  {/* Icon */}
                  <div className={`p-1.5 rounded-lg text-white ${msg.sender === "user" ? "bg-slate-800" : "bg-indigo-950/40 border border-indigo-500/20"}`}>
                    {msg.sender === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>

                  {/* Body */}
                  <div
                    className={`p-3.5 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap ${
                      msg.sender === "user"
                        ? "bg-indigo-650 text-white rounded-tr-none font-medium shadow-md shadow-indigo-950/20"
                        : "bg-slate-900/60 border border-slate-900 text-slate-200 rounded-tl-none"
                    }`}
                  >
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
        )}
      </div>

      {/* Suggestion Chips */}
      {!loading && messages.length < 5 && (
        <div className="px-4 pb-2 pt-2 flex flex-wrap gap-2 overflow-x-auto scrollbar-none border-t border-slate-900 bg-slate-950/10">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(s)}
              className="text-[10px] text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-850 px-3 py-1.5 rounded-full transition-all duration-200 flex items-center space-x-1"
            >
              <span>{s}</span>
              <ChevronRight className="w-3 h-3 text-indigo-400" />
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t border-slate-900 bg-slate-900/10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          {/* Speaker Toggle */}
          <button
            type="button"
            onClick={toggleSpeakReplies}
            className={`p-3 rounded-xl border transition-colors flex items-center justify-center cursor-pointer shrink-0 ${
              isSpeaking
                ? "bg-emerald-950/60 border-emerald-500 text-emerald-400 animate-pulse"
                : speakReplies
                ? "bg-emerald-950/40 border-emerald-800 text-emerald-400"
                : "bg-slate-950/60 border-slate-900 text-slate-500 hover:text-slate-300"
            }`}
            title={speakReplies ? "Mute Spoken Replies" : "Enable Spoken Replies"}
          >
            {speakReplies ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={loading}
            placeholder={
              loading
                ? "Bron is executing tools..."
                : isRecording
                ? "Listening... Speak now..."
                : "Type instruction or speak..."
            }
            className="flex-1 bg-slate-950/60 border border-slate-900 text-xs rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-50"
          />

          {/* Mic Button */}
          <button
            type="button"
            onClick={toggleRecording}
            disabled={loading}
            className={`p-3 rounded-xl border transition-colors flex items-center justify-center cursor-pointer shrink-0 disabled:opacity-30 ${
              isRecording
                ? "bg-red-950/40 border-red-800 text-red-400 animate-pulse"
                : "bg-slate-950/60 border-slate-900 text-slate-400 hover:text-white"
            }`}
            title={isRecording ? "Stop Recording" : "Start Recording"}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            type="submit"
            disabled={loading || !inputValue.trim()}
            className="bg-indigo-600 hover:bg-indigo-550 text-white p-3 rounded-xl transition-colors disabled:opacity-30 flex items-center justify-center cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

    </div>
  );
}
