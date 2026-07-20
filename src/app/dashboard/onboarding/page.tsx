"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Share2,
  Globe,
  ShieldAlert,
  ListPlus,
  Trash2,
  Loader2,
  Upload,
  FileText,
  DollarSign,
  ArrowRight
} from "lucide-react";

interface ClientDetails {
  name: string;
  ad_budget?: number;
  deliverables_per_month?: number;
  whatsapp_group_id?: string;
  target_audience?: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  
  // Navigation & Wizard State
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  // Summary view state
  const [onboardedClient, setOnboardedClient] = useState<ClientDetails | null>(null);

  // Form Fields
  const [brandName, setBrandName] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [deliverablesPerMonth, setDeliverablesPerMonth] = useState("4");
  const [adBudget, setAdBudget] = useState("50000");
  const [whatsappGroupId, setWhatsappGroupId] = useState("");

  // File objects
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [guidelinesFile, setGuidelinesFile] = useState<File | null>(null);
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");

  const [products, setProducts] = useState<string[]>([""]);

  // Dynamic Product list managers
  const handleAddProduct = () => {
    setProducts([...products, ""]);
  };

  const handleProductChange = (index: number, value: string) => {
    const updated = [...products];
    updated[index] = value;
    setProducts(updated);
  };

  const handleRemoveProduct = (index: number) => {
    const updated = products.filter((_, idx) => idx !== index);
    setProducts(updated.length ? updated : [""]);
  };

  // Safe file upload wrapper to Supabase Storage
  const uploadToStorage = async (file: File, folder: string): Promise<string> => {
    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    setUploadStatus(`Uploading ${file.name}...`);

    const { data, error: uploadErr } = await supabase.storage
      .from("brand-assets")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      throw new Error(`Failed to upload ${file.name}: ${uploadErr.message}`);
    }

    return data.path; // Returns bucket relative path e.g. "logos/12345.png"
  };

  // Submit onboarding
  const handleOnboardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUploadStatus("Initializing assets upload...");

    try {
      let finalLogoPath = "";
      let finalGuidelinesPath = "";

      // 1. Upload Logo if present
      if (logoFile) {
        finalLogoPath = await uploadToStorage(logoFile, "logos");
      }

      // 2. Upload Guidelines if present
      if (guidelinesFile) {
        finalGuidelinesPath = await uploadToStorage(guidelinesFile, "guidelines");
      }

      setUploadStatus("Registering brand & running AI synthesis...");

      const socialAccounts = { instagram, facebook };
      const filteredProducts = products.map(p => p.trim()).filter(Boolean);

      // 3. Post to Onboarding API
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brandName,
          logoUrl: finalLogoPath,
          guidelinesUrl: finalGuidelinesPath,
          socialAccounts,
          products: filteredProducts,
          targetAudience,
          deliverablesPerMonth: Number(deliverablesPerMonth),
          adBudget: Number(adBudget),
          whatsappGroupId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to complete onboarding");
      }

      // 4. Show summary view
      setOnboardedClient(data.client);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "An unexpected error occurred during onboarding.";
      setError(message);
    } finally {
      setLoading(false);
      setUploadStatus("");
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 px-2 py-4">
      {/* Top Banner */}
      {!onboardedClient && (
        <div className="flex flex-col space-y-1 pb-4 border-b border-slate-900">
          <div className="flex items-center space-x-2 text-indigo-400 text-[10px] font-bold tracking-widest uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Launch Pipeline</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Onboard Client</h1>
          <p className="text-slate-400 text-xs">Register parameters & run AI guideline synthesis</p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 flex items-start space-x-3 text-red-200 text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0 text-red-400" />
          <span className="leading-tight">{error}</span>
        </div>
      )}

      {onboardedClient ? (
        /* Summary Card View - Mobile-friendly & highly responsive */
        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
          
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-emerald-950/40 border border-emerald-800/80 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Client Profile Created</h3>
            <p className="text-xs text-slate-500">SWAD profile and brand memory initialized</p>
          </div>

          <div className="border-t border-b border-slate-900 py-4 space-y-3.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Brand Name</span>
              <span className="text-slate-200 font-bold">{onboardedClient.name}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Monthly Budget</span>
              <span className="text-slate-200 font-semibold flex items-center">
                <DollarSign className="w-3.5 h-3.5 mr-0.5 text-indigo-400" />
                {onboardedClient.ad_budget?.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Deliverables</span>
              <span className="text-slate-200 font-semibold">{onboardedClient.deliverables_per_month} ads/month</span>
            </div>
            {onboardedClient.whatsapp_group_id && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">WhatsApp ID</span>
                <span className="text-slate-300 font-mono text-[10px] truncate max-w-[150px]">{onboardedClient.whatsapp_group_id}</span>
              </div>
            )}
            <div className="pt-2">
              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target Audience</span>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/30 p-2.5 rounded-lg border border-slate-900">{onboardedClient.target_audience}</p>
            </div>
          </div>

          <button
            onClick={() => {
              router.push("/dashboard/brand-brain");
              router.refresh();
            }}
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center space-x-2 text-xs transition-all cursor-pointer shadow-lg shadow-emerald-950/40"
          >
            <span>Open Brand Brain</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Wizard form containing the client creation fields */
        <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 md:p-8 relative">
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />
          
          {/* Mobile-friendly horizontal wizard stepper */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-900 text-xs">
            <span className={`font-semibold ${step >= 1 ? "text-indigo-400" : "text-slate-600"}`}>1. Overview</span>
            <span className="text-slate-800">/</span>
            <span className={`font-semibold ${step >= 2 ? "text-indigo-400" : "text-slate-600"}`}>2. Assets</span>
            <span className="text-slate-800">/</span>
            <span className={`font-semibold ${step >= 3 ? "text-indigo-400" : "text-slate-600"}`}>3. Products</span>
          </div>

          <form onSubmit={handleOnboardSubmit} className="space-y-5">
            
            {/* Step 1: Overview */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Brand / Client Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SWAD"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">WhatsApp Group ID</label>
                  <input
                    type="text"
                    placeholder="e.g. 1203632148729_swad@g.us"
                    value={whatsappGroupId}
                    onChange={(e) => setWhatsappGroupId(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Deliverables / Month</label>
                    <input
                      type="number"
                      required
                      value={deliverablesPerMonth}
                      onChange={(e) => setDeliverablesPerMonth(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-indigo-500/80 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ad Budget (INR)</label>
                    <input
                      type="number"
                      required
                      value={adBudget}
                      onChange={(e) => setAdBudget(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white focus:outline-none focus:border-indigo-500/80 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Target Audience Demographics</label>
                  <textarea
                    required
                    rows={4}
                    placeholder="e.g. Indian diaspora families seeking authentic home flavors, and busy urban households wishing for convenient ready-to-eat solutions."
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all resize-none"
                  />
                </div>
              </div>
            )}

            {/* Step 2: Assets & Uploads */}
            {step === 2 && (
              <div className="space-y-5">
                {/* Logo Upload */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Brand Logo File</label>
                  <div className="border border-dashed border-slate-800 rounded-xl p-4 bg-slate-900/20 flex flex-col items-center justify-center text-center relative hover:border-slate-700 transition-all">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="w-5 h-5 text-indigo-400 mb-2" />
                    {logoFile ? (
                      <p className="text-xs text-emerald-400 font-semibold truncate max-w-full">{logoFile.name}</p>
                    ) : (
                      <p className="text-xs text-slate-400 font-medium">Select logo image (PNG/JPG)</p>
                    )}
                  </div>
                </div>

                {/* Guidelines PDF Upload */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Design / Brand Guidelines PDF</label>
                  <div className="border border-dashed border-slate-800 rounded-xl p-4 bg-slate-900/20 flex flex-col items-center justify-center text-center relative hover:border-slate-700 transition-all">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setGuidelinesFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <FileText className="w-5 h-5 text-indigo-400 mb-2" />
                    {guidelinesFile ? (
                      <p className="text-xs text-emerald-400 font-semibold truncate max-w-full">{guidelinesFile.name}</p>
                    ) : (
                      <p className="text-xs text-slate-400 font-medium">Select guidelines PDF file</p>
                    )}
                  </div>
                </div>

                {/* Social links */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center">
                      <Share2 className="w-3.5 h-3.5 mr-1 text-pink-400" /> Instagram
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. @swad_foods"
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center">
                      <Globe className="w-3.5 h-3.5 mr-1 text-blue-400" /> Facebook
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. swadfoods"
                      value={facebook}
                      onChange={(e) => setFacebook(e.target.value)}
                      className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Offerings */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Products & Services</label>
                  <button
                    type="button"
                    onClick={handleAddProduct}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-900 text-[10px] font-bold text-indigo-300 hover:bg-indigo-900/40 transition-all cursor-pointer"
                  >
                    <ListPlus className="w-3 h-3" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                  {products.map((product, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <input
                        type="text"
                        required
                        placeholder="e.g. Garam Masala Blend Spices"
                        value={product}
                        onChange={(e) => handleProductChange(idx, e.target.value)}
                        className="flex-1 bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveProduct(idx)}
                        className="p-2.5 rounded-xl border border-slate-900 bg-slate-950 hover:bg-red-950/20 hover:border-red-950/50 hover:text-red-400 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-900 mt-6 text-xs">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="flex items-center space-x-1.5 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
              ) : (
                <div />
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 1 && !brandName.trim()) {
                      setError("Brand Name is required to proceed.");
                      return;
                    }
                    setError(null);
                    setStep(step + 1);
                  }}
                  className="flex items-center space-x-1.5 py-2 px-4 bg-slate-900/60 border border-slate-800 text-white rounded-xl hover:border-slate-700 transition-all cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center space-x-1.5 py-2 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-indigo-950/50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-[11px] animate-pulse">{uploadStatus || "Onboarding..."}</span>
                    </>
                  ) : (
                    <>
                      <span>Submit Profile</span>
                      <Sparkles className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </div>

          </form>
        </div>
      )}
    </div>
  );
}
