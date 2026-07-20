import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Sparkles,
  Layers,
  ChevronRight,
  UserCheck,
  TrendingUp,
  Briefcase
} from "lucide-react";

export default async function BrandBrainIndexPage() {
  const supabase = await createClient();

  // Fetch all clients
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, logo_url, deliverables_per_month, ad_budget")
    .order("name", { ascending: true });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
            <Layers className="w-4 h-4" />
            <span>Identity Hub</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Brand Brain Explorer</h1>
          <p className="text-slate-400 text-xs mt-1">Manage core guidelines, assets, feedback, and AI briefs per client</p>
        </div>
        <Link
          href="/dashboard/onboarding"
          className="inline-flex items-center justify-center space-x-2 bg-indigo-950/40 border border-indigo-900 text-indigo-300 font-semibold py-2.5 px-4 rounded-xl text-xs hover:bg-indigo-900/40 transition-all cursor-pointer"
        >
          <span>Onboard New Client</span>
          <Sparkles className="w-3.5 h-3.5" />
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs">
          Failed to load clients: {error.message}. (Ensure migrations have been run in Supabase SQL editor!)
        </div>
      )}

      {/* Clients Grid */}
      {!clients || clients.length === 0 ? (
        <div className="bg-slate-950/45 border border-slate-900 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Briefcase className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-300">No Clients Found</h3>
            <p className="text-xs text-slate-500 mt-1">To start managing brand memories, please onboard your first client.</p>
          </div>
          <Link
            href="/dashboard/onboarding"
            className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer"
          >
            <span>Onboard Now</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/dashboard/brand-brain/${client.id}`}
              className="group bg-slate-950/40 border border-slate-900 hover:border-slate-800 rounded-2xl p-5 block transition-all relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 left-0 h-[1.5px] bg-gradient-to-r from-transparent via-indigo-500/0 group-hover:via-indigo-500/20 to-transparent transition-all" />
              
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center text-indigo-400 font-bold text-xs uppercase">
                      {client.name.substring(0, 2)}
                    </div>
                    <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors text-sm">{client.name}</h3>
                  </div>
                  
                  <div className="flex items-center space-x-4 text-[10px] text-slate-500">
                    <div className="flex items-center space-x-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{client.deliverables_per_month} ads/mo</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>Budget: INR {client.ad_budget?.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
                
                <div className="w-7 h-7 rounded-lg border border-slate-900 group-hover:border-slate-800 bg-slate-950 flex items-center justify-center text-slate-500 group-hover:text-indigo-400 transition-all">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
