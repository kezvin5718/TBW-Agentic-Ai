"use client";

import { useEffect, useRef, useState } from "react";

export type CoreState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Bron's face.
 *
 * A reactor dial rather than a logo: it is driven by what Bron is actually
 * doing, so a glance tells you whether he is waiting, hearing you, working, or
 * talking. Idle turns slowly and dim; listening breathes with the room's own
 * loudness (read from the microphone, not faked); thinking spins up and goes
 * amber; speaking pulses in time with the reply.
 *
 * All SVG and CSS — no images, no canvas, no library — so it stays sharp at any
 * size and costs nothing to render.
 */
export default function BronCore({
  state = "idle",
  label,
  size = 260,
}: {
  state?: CoreState;
  label?: string;
  size?: number;
}) {
  // 0..1 loudness, only while listening. Silence keeps the ring calm rather
  // than jittering on noise.
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      setLevel(0);
    };

    if (state !== "listening") {
      stop();
      return;
    }

    (async () => {
      try {
        // The mic is already open for recording; asking again returns the same
        // permission, and the analyser only reads — it never records anything.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (const v of data) sum += v;
          const avg = sum / data.length / 255;
          // Ease towards the new value so the ring glides instead of flickering.
          setLevel((prev) => prev + (Math.min(1, avg * 2.6) - prev) * 0.25);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // No mic permission — the dial simply stays calm.
      }
    })();

    return () => { cancelled = true; stop(); };
  }, [state]);

  const palette = {
    idle: { main: "#38bdf8", glow: "rgba(56,189,248,0.35)", dim: "rgba(56,189,248,0.16)" },
    listening: { main: "#34d399", glow: "rgba(52,211,153,0.45)", dim: "rgba(52,211,153,0.18)" },
    thinking: { main: "#fbbf24", glow: "rgba(251,191,36,0.45)", dim: "rgba(251,191,36,0.18)" },
    speaking: { main: "#818cf8", glow: "rgba(129,140,248,0.5)", dim: "rgba(129,140,248,0.2)" },
  }[state];

  const spin = { idle: "38s", listening: "22s", thinking: "6s", speaking: "14s" }[state];
  const counter = { idle: "52s", listening: "30s", thinking: "9s", speaking: "20s" }[state];
  const caption = label ?? { idle: "READY", listening: "LISTENING", thinking: "WORKING", speaking: "SPEAKING" }[state];

  // Ticks around the outer rim; the long ones mark quarters.
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  // The listening ring grows with the room; the others hold a steady radius.
  const liveR = 74 + (state === "listening" ? level * 12 : 0);

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size} style={{ filter: `drop-shadow(0 0 24px ${palette.glow})` }}>
        <defs>
          <radialGradient id="bronCoreFill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.main} stopOpacity="0.30" />
            <stop offset="55%" stopColor={palette.main} stopOpacity="0.06" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bronArc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.main} stopOpacity="0" />
            <stop offset="45%" stopColor={palette.main} stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        <circle cx="100" cy="100" r="92" fill="url(#bronCoreFill)" />

        {/* Rim ticks */}
        <g opacity="0.55">
          {ticks.map((i) => {
            const a = (i * 6 * Math.PI) / 180;
            const long = i % 5 === 0;
            const r1 = long ? 84 : 88, r2 = 92;
            return (
              <line key={i}
                x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1}
                x2={100 + Math.cos(a) * r2} y2={100 + Math.sin(a) * r2}
                stroke={palette.main} strokeWidth={long ? 1.6 : 0.7}
                opacity={long ? 0.85 : 0.4} />
            );
          })}
        </g>

        {/* Outer ring, turning one way */}
        <g style={{ transformOrigin: "100px 100px", animation: `bron-spin ${spin} linear infinite` }}>
          <circle cx="100" cy="100" r="80" fill="none" stroke={palette.dim} strokeWidth="1" />
          <circle cx="100" cy="100" r="80" fill="none" stroke="url(#bronArc)" strokeWidth="2.6"
            strokeLinecap="round" strokeDasharray="150 353" />
          <circle cx="100" cy="100" r="80" fill="none" stroke={palette.main} strokeWidth="1.4"
            strokeLinecap="round" strokeDasharray="26 477" strokeDashoffset="-250" opacity="0.9" />
        </g>

        {/* Segmented ring, turning the other */}
        <g style={{ transformOrigin: "100px 100px", animation: `bron-spin-rev ${counter} linear infinite` }}>
          <circle cx="100" cy="100" r="67" fill="none" stroke={palette.main} strokeWidth="5"
            strokeDasharray="3 9" opacity="0.35" />
        </g>

        {/* The live ring — the one that reacts */}
        <circle cx="100" cy="100" r={liveR} fill="none" stroke={palette.main}
          strokeWidth={state === "listening" ? 1.2 + level * 2.2 : 1.2}
          opacity={state === "idle" ? 0.35 : 0.75}
          style={{ transition: "r 90ms linear, stroke-width 90ms linear" }}>
          {state !== "listening" && (
            <animate attributeName="opacity" values="0.75;0.3;0.75"
              dur={state === "thinking" ? "1.1s" : state === "speaking" ? "0.8s" : "3.4s"} repeatCount="indefinite" />
          )}
        </circle>

        {/* Inner core */}
        <circle cx="100" cy="100" r="52" fill="none" stroke={palette.dim} strokeWidth="1" />
        <g style={{ transformOrigin: "100px 100px", animation: `bron-spin ${state === "thinking" ? "3.2s" : "18s"} linear infinite` }}>
          <circle cx="100" cy="100" r="44" fill="none" stroke={palette.main} strokeWidth="1.8"
            strokeLinecap="round" strokeDasharray="60 216" opacity="0.85" />
        </g>

        {/* Speaking waveform, drawn only while he is talking */}
        {state === "speaking" && (
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect key={i} x={82 + i * 6} y="96" width="2.6" rx="1.3" fill={palette.main}>
                <animate attributeName="height" values="4;16;7;19;4" dur={`${0.55 + i * 0.09}s`} repeatCount="indefinite" />
                <animate attributeName="y" values="98;92;96;90;98" dur={`${0.55 + i * 0.09}s`} repeatCount="indefinite" />
              </rect>
            ))}
          </g>
        )}

        {/* Name */}
        {state !== "speaking" && (
          <text x="100" y="104" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="800" letterSpacing="6"
            style={{ textShadow: `0 0 16px ${palette.glow}` }}>BRON</text>
        )}
        <text x="100" y="122" textAnchor="middle" fill={palette.main} fontSize="7.5" fontWeight="700" letterSpacing="3.4" opacity="0.9">
          {caption}
        </text>
      </svg>

      <style>{`
        @keyframes bron-spin { to { transform: rotate(360deg); } }
        @keyframes bron-spin-rev { to { transform: rotate(-360deg); } }
      `}</style>
    </div>
  );
}
