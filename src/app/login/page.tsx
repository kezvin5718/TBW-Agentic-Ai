"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Sparkles, Mail, Lock, User, Shield, Briefcase, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"founder" | "employee" | "client">("client");
  const [brandName, setBrandName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const supabase = createClient();

  const isConfigMissing =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === "https://placeholder-project.supabase.co" ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === "placeholder-anon-key";

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isSignUp) {
        // Sign up logic
        const metadata: Record<string, string> = {
          name: fullName || email.split("@")[0],
          role,
        };
        if (role === "client") {
          if (!brandName.trim()) {
            throw new Error("Brand Name is required for clients");
          }
          metadata.brand_name = brandName.trim();
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
          },
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          setSuccess("Registration successful! Redirecting...");
          router.replace(nextPath);
          router.refresh();
        } else {
          setSuccess("Account created! Please check your email for a confirmation link (or log in directly if email confirmation is disabled).");
          setIsSignUp(false);
        }
      } else {
        // Sign in logic
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;

        setSuccess("Login successful! Redirecting...");
        router.replace(nextPath);
        router.refresh();
      }
    } catch (err: unknown) {
      console.error("Authentication error:", err);
      const message = err instanceof Error ? err.message : "An unexpected authentication error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-12 gap-12 items-center z-10">
      
      {/* Left Side: Agency branding */}
      <div className="md:col-span-6 flex flex-col space-y-6 text-left">
        <div className="flex items-center space-x-2 bg-slate-900/50 border border-slate-800/80 px-3 py-1.5 rounded-full w-fit">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <span className="text-xs font-semibold tracking-wider uppercase text-indigo-300">Agentic AI Agency Platform</span>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-400 bg-clip-text text-transparent leading-tight">
          tbw-os
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed max-w-md">
          The intelligent operations engine for <span className="text-indigo-300 font-semibold">TBW Advertising</span>. Automating AI ad generation, campaign planning, publishing, and analytics for brands across India.
        </p>

        <div className="hidden md:flex flex-col space-y-4 border-l-2 border-indigo-950 pl-6 py-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-200">Creative Production Automation</h4>
            <p className="text-xs text-slate-400">Streamline workflows from scriptwriting to automated rendering.</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-200">Multi-Channel Deployment</h4>
            <p className="text-xs text-slate-400">Deploy approved creatives directly to Meta and other platforms.</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-200">Continuous Brand Learning</h4>
            <p className="text-xs text-slate-400">Feedback insights automatically back into the Brand Brain.</p>
          </div>
        </div>
      </div>

      {/* Right Side: Glassmorphic auth card */}
      <div className="md:col-span-6">
        <div className="bg-slate-950/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative">
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
          
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white">
              {isSignUp ? "Create Workspace Account" : "Access Workspace"}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {isSignUp ? "Sign up to join the operations stream" : "Sign in to access your modules"}
            </p>
          </div>

          {/* Configuration Missing Warning */}
          {isConfigMissing && (
            <div className="mb-6 p-4 rounded-lg bg-amber-950/20 border border-amber-900/40 flex items-start space-x-3 text-amber-200 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold text-sm mb-1 text-amber-300">Configuration Required</p>
                <p className="leading-relaxed">Please copy <code>.env.example</code> to <code>.env</code> (or <code>.env.local</code>) and fill in your Supabase credentials to enable auth connectivity.</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-950/30 border border-red-900/50 flex items-start space-x-3 text-red-200 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mb-6 p-4 rounded-lg bg-emerald-950/30 border border-emerald-900/50 flex items-start space-x-3 text-emerald-200 text-sm">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-5">
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Shikhar Sharma"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="name@tbw.agency"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                />
              </div>
            </div>

            {isSignUp && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Workspace Role</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole("founder")}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                        role === "founder"
                          ? "bg-indigo-950/40 border-indigo-500/80 text-indigo-300"
                          : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <Shield className="w-4 h-4 mb-1" />
                      Founder
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("employee")}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                        role === "employee"
                          ? "bg-indigo-950/40 border-indigo-500/80 text-indigo-300"
                          : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <Briefcase className="w-4 h-4 mb-1" />
                      Employee
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("client")}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                        role === "client"
                          ? "bg-indigo-950/40 border-indigo-500/80 text-indigo-300"
                          : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <User className="w-4 h-4 mb-1" />
                      Client
                    </button>
                  </div>
                </div>

                {role === "client" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Brand / Client Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Tata Motors"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                    />
                  </div>
                )}
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-indigo-950/50 hover:shadow-indigo-950 flex items-center justify-center space-x-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <span>{loading ? "Processing..." : isSignUp ? "Create Account" : "Access Console"}</span>
              {!loading && <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          {/* Account toggle link */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setSuccess(null);
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              {isSignUp ? "Already have an account? Sign In" : "Need workspace access? Create an Account"}
            </button>
          </div>

          {/* Development Notice */}
          <div className="mt-8 pt-6 border-t border-slate-900 text-[11px] text-slate-500 flex flex-col space-y-1.5">
            <p className="font-semibold text-slate-400 flex items-center space-x-1">
              <span>Developer Note:</span>
            </p>
            <p>
              Profiles and role metadata are automatically synchronized to public tables via database triggers upon registration. Select your role when signing up to test authorization rules.
            </p>
          </div>

        </div>
      </div>

    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#07070a] text-slate-100 flex flex-col justify-center relative overflow-hidden font-sans">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-950/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-purple-950/20 blur-[120px] pointer-events-none" />
      
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 animate-pulse" />
          <p className="text-slate-400 text-sm font-semibold tracking-wider uppercase animate-pulse">Initializing Console...</p>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
