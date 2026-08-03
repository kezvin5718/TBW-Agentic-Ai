import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";

export default async function PendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("name, approved").eq("id", user.id).maybeSingle();
  if (profile?.approved) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="max-w-md w-full bg-slate-900/40 border border-slate-800 rounded-3xl p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-950/40 border border-amber-900 flex items-center justify-center mx-auto">
          <Clock className="w-7 h-7 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Account pending approval</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          Thanks{profile?.name ? `, ${profile.name}` : ""} — your account has been created and is <span className="text-amber-400 font-semibold">waiting for a founder to approve it</span>. You&apos;ll get full access as soon as it&apos;s approved.
        </p>
        <p className="text-[11px] text-slate-600">Signed in as {user.email}</p>
        <form action="/auth/signout" method="POST">
          <button className="w-full py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white text-xs font-bold uppercase tracking-wider cursor-pointer">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
