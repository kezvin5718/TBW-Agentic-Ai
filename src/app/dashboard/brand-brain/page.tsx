import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClientGrid, { type ClientRow } from "./ClientGrid";
import {
  Sparkles,
  Layers,
  Briefcase
} from "lucide-react";

export default async function BrandBrainIndexPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const isFounder = (user?.user_metadata?.role as string) === "founder";

  // Archived clients come through too — the grid keeps them in their own
  // collapsed section rather than hiding them from the one page that manages them.
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, logo_url, deliverables_per_month, ad_budget, archived_at")
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
        <ClientGrid clients={clients as ClientRow[]} isFounder={isFounder} />
      )}
    </div>
  );
}
