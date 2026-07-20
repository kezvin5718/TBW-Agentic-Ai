import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Sparkles,
  ChevronRight,
  TrendingUp,
  Award,
  Video,
  Settings,
  Users,
  Eye,
  FileCheck2,
  ListTodo,
  AlertTriangle,
  AlertCircle,
  Clock,
  Calendar,
  CheckCircle,
  TrendingDown
} from "lucide-react";

interface FounderMetrics {
  leadCount: number;
  convertedCount: number;
  activeCampaignsCount: number;
  roasThisWeek: number;
  roasLastWeek: number;
  spendThisWeek: number;
  alerts: string[];
}

interface EmployeeTask {
  id: string;
  status: string;
  type: string;
  deadline: string;
  plan: {
    clients: {
      name: string;
    } | null;
  } | null;
}

interface PublishedCreative {
  id: string;
  published_at: string;
  type: string;
  caption: string;
  media_url?: string;
}

interface ClientData {
  clientObj: Record<string, unknown> | null;
  latestPlan: {
    strategy_summary: string;
    content_calendar: Record<string, string>[];
  } | null;
  totalSpend: number;
  totalImpressions: number;
  totalLeads: number;
  publishedCount: number;
  recentPublished: PublishedCreative[];
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = user.user_metadata?.role || "client";
  const brandName = user.user_metadata?.brand_name || "";
  const name = user.user_metadata?.name || user.email?.split("@")[0] || "Team Member";

  // 1. Fetch Shared metrics data
  const { data: pendingApprovals } = await supabase
    .from("approvals")
    .select("*, clients(name)")
    .eq("decision", "pending");

  const nowIso = new Date().toISOString();
  const { data: overdueTasks } = await supabase
    .from("tasks")
    .select("*, plan:monthly_plans(client_id)")
    .neq("status", "done")
    .lt("deadline", nowIso);

  // 2. Fetch specific datasets based on role
  let founderMetrics: FounderMetrics = {
    leadCount: 0,
    convertedCount: 0,
    activeCampaignsCount: 0,
    roasThisWeek: 0,
    roasLastWeek: 0,
    spendThisWeek: 0,
    alerts: [],
  };
  let employeeTasks: EmployeeTask[] = [];
  let clientData: ClientData = {
    clientObj: null,
    latestPlan: null,
    totalSpend: 0,
    totalImpressions: 0,
    totalLeads: 0,
    publishedCount: 0,
    recentPublished: [],
  };

  if (role === "founder") {
    // Lead Pipeline Summary
    const { data: leads } = await supabase.from("leads").select("*");
    const leadCount = leads?.length || 0;
    const convertedCount = leads?.filter((l) => l.status === "converted").length || 0;

    // Campaigns list
    const { data: campaigns } = await supabase.from("campaigns").select("*, clients(name)");
    const activeCampaigns = campaigns?.filter((c) => c.status === "ACTIVE") || [];

    // Calculate weekly metrics comparing this week vs last week
    const past7Days = new Date();
    past7Days.setDate(past7Days.getDate() - 7);
    const past14Days = new Date();
    past14Days.setDate(past14Days.getDate() - 14);

    const { data: recentMetrics } = await supabase
      .from("metrics_daily")
      .select("*, campaigns(id, client_id)")
      .gte("date", past14Days.toISOString().split("T")[0]);

    // Group by week
    let spendThisWeek = 0;
    let leadsThisWeek = 0;
    let spendLastWeek = 0;
    let leadsLastWeek = 0;

    (recentMetrics || []).forEach((m) => {
      const metricDate = new Date(m.date);
      if (metricDate >= past7Days) {
        spendThisWeek += Number(m.spend || 0);
        leadsThisWeek += Number(m.leads || 0);
      } else {
        spendLastWeek += Number(m.spend || 0);
        leadsLastWeek += Number(m.leads || 0);
      }
    });

    const roasThisWeek = spendThisWeek > 0 ? (leadsThisWeek * 200) / spendThisWeek : 0;
    const roasLastWeek = spendLastWeek > 0 ? (leadsLastWeek * 200) / spendLastWeek : 0;

    // Detect Alerts
    const alerts: string[] = [];
    (activeCampaigns || []).forEach((c) => {
      // Find campaign metrics from yesterday
      const yesterdayStr = new Date();
      yesterdayStr.setDate(yesterdayStr.getDate() - 1);
      const yesterdayIso = yesterdayStr.toISOString().split("T")[0];

      const cMetrics = (recentMetrics || []).filter(
        (m) => m.campaign_id === c.id && m.date === yesterdayIso
      );

      if (cMetrics.length > 0) {
        const m = cMetrics[0];
        const ctr = Number((m.results as Record<string, unknown>)?.ctr_percentage || 0);
        const spend = Number(m.spend || 0);
        const impressions = Number(m.impressions || 0);

        if (ctr < 0.2 && impressions > 100) {
          alerts.push(`Campaign "${c.clients?.name || "Meta campaign"}" is experiencing a CTR collapse (${ctr}%).`);
        }
        if (spend > Number(c.budget_per_day) * 1.15) {
          alerts.push(`Campaign "${c.clients?.name || "Meta campaign"}" daily spend cap exceeded pacing rules (Spent Rs. ${spend}).`);
        }
      } else {
        alerts.push(`Campaign "${c.clients?.name || "Meta campaign"}" has zero delivery recorded yesterday.`);
      }
    });

    founderMetrics = {
      leadCount,
      convertedCount,
      activeCampaignsCount: activeCampaigns.length,
      roasThisWeek,
      roasLastWeek,
      spendThisWeek,
      alerts,
    };
  }

  if (role === "employee") {
    // Tasks assigned to this profile
    const { data: myTasks } = await supabase
      .from("tasks")
      .select("*, plan:monthly_plans(clients(name))")
      .eq("assignee_id", user.id)
      .order("deadline", { ascending: true });

    employeeTasks = myTasks || [];
  }

  if (role === "client") {
    // Retrieve client details
    const { data: clientObj } = await supabase
      .from("clients")
      .select("*")
      .eq("name", brandName)
      .limit(1)
      .maybeSingle();

    if (clientObj) {
      // Fetch plan
      const { data: plans } = await supabase
        .from("monthly_plans")
        .select("*")
        .eq("client_id", clientObj.id)
        .order("month", { ascending: false })
        .limit(1);

      // Fetch campaign stats
      const { data: clientCampaigns } = await supabase
        .from("campaigns")
        .select("id")
        .eq("client_id", clientObj.id);

      const clientCampaignIds = (clientCampaigns || []).map((c) => c.id);
      let totalSpend = 0;
      let totalLeads = 0;
      let totalImpressions = 0;

      if (clientCampaignIds.length > 0) {
        const { data: clientMetrics } = await supabase
          .from("metrics_daily")
          .select("*")
          .in("campaign_id", clientCampaignIds);

        (clientMetrics || []).forEach((m) => {
          totalSpend += Number(m.spend || 0);
          totalLeads += Number(m.leads || 0);
          totalImpressions += Number(m.impressions || 0);
        });
      }

      // Fetch published creatives
      const { data: creativesList } = await supabase
        .from("creatives")
        .select("*, tasks(plan_id)")
        .eq("founder_approval", "approved")
        .eq("client_approval", "approved")
        .order("published_at", { ascending: false });

      const clientCreatives = (creativesList || []).filter((c) => {
        const plan = activeClientPlan(plans || [], c.tasks?.plan_id);
        return !!plan;
      });

      clientData = {
        clientObj,
        latestPlan: plans?.[0] || null,
        totalSpend,
        totalLeads,
        totalImpressions,
        publishedCount: clientCreatives.length,
        recentPublished: clientCreatives.slice(0, 5),
      };
    }
  }

  function activeClientPlan(plansList: Record<string, unknown>[], planId: string): boolean {
    return plansList.some((p) => p.id === planId);
  }

  return (
    <div className="space-y-10 text-left">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-900 pb-8 space-y-4 md:space-y-0">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold tracking-wider uppercase mb-1">
            <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span>Operational Console</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            {role === "founder" && `Namaste, Founder`}
            {role === "employee" && `Welcome Back, ${name}`}
            {role === "client" && `Workspace: ${brandName || "Client Portal"}`}
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Logged in as <span className="text-slate-350 font-semibold">{name}</span> ({role.toUpperCase()})
          </p>
        </div>
        
        {role === "founder" && (
          <div className="flex items-center space-x-3 bg-slate-950/40 border border-slate-900 p-3 rounded-xl text-[10px] text-slate-400 font-medium">
            <Settings className="w-4 h-4 text-indigo-400 animate-spin" style={{ animationDuration: '6s' }} />
            <span>Systems online. Vercel Cron status: <strong className="text-emerald-400 font-extrabold">ACTIVE</strong></span>
          </div>
        )}
      </div>

      {/* ================= FOUNDER DASHBOARD ================= */}
      {role === "founder" && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Metrics summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Today&apos;s Pending Approvals</p>
              <h3 className="text-2xl font-extrabold text-white">{pendingApprovals?.length || 0}</h3>
              <p className="text-[9px] text-slate-500">Awaiting client / internal feedback</p>
            </div>
            
            <div className="bg-slate-955/40 border border-slate-900 rounded-2xl p-5 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Overdue Tasks</p>
              <h3 className="text-2xl font-extrabold text-red-400">{overdueTasks?.length || 0}</h3>
              <p className="text-[9px] text-slate-550 font-medium">Missed deadlines alert</p>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Weekly Spend</p>
              <h3 className="text-2xl font-extrabold text-white">Rs. {founderMetrics.spendThisWeek}</h3>
              <p className="text-[9px] text-emerald-400 font-bold">Blended weekly pacing</p>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lead Conversion Rate</p>
              <h3 className="text-2xl font-extrabold text-white">
                {founderMetrics.leadCount > 0 
                  ? `${Math.round((founderMetrics.convertedCount / founderMetrics.leadCount) * 100)}%`
                  : "0%"
                }
              </h3>
              <p className="text-[9px] text-slate-500 font-semibold">{founderMetrics.convertedCount} of {founderMetrics.leadCount} prospects converted</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left side: MER/ROAS grid & Alerts */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* MER / ROAS Performance list */}
              <div className="bg-slate-950/20 border border-slate-900 rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-slate-900">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>Marketing Efficiency & ROAS Trends</span>
                  </h3>
                  <span className="text-[9px] text-slate-500 uppercase font-mono">This Week vs Last Week</span>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase font-mono px-2">
                    <span>Performance Metrics</span>
                    <div className="flex space-x-8">
                      <span>Last Week</span>
                      <span>This Week</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/10 border border-slate-900/40 p-4 rounded-xl flex items-center justify-between transition-colors hover:bg-slate-900/20">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-200">Blended Ad Account ROAS</span>
                      <p className="text-[9.5px] text-slate-500">Calculated on lead valuations</p>
                    </div>

                    <div className="flex items-center space-x-8 font-mono text-xs font-bold">
                      <span className="text-slate-500">{founderMetrics.roasLastWeek.toFixed(2)}x</span>
                      <span className={`flex items-center space-x-1 ${
                        founderMetrics.roasThisWeek >= founderMetrics.roasLastWeek 
                          ? "text-emerald-400" 
                          : "text-red-400"
                      }`}>
                        {founderMetrics.roasThisWeek >= founderMetrics.roasLastWeek ? (
                          <TrendingUp className="w-3.5 h-3.5" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5" />
                        )}
                        <span>{founderMetrics.roasThisWeek.toFixed(2)}x</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Anomaly Alerts List */}
              <div className="bg-slate-950/20 border border-slate-900 rounded-2xl p-5 space-y-4">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-red-400 uppercase tracking-wide border-b border-slate-900 pb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Real-Time Ad Operations Anomalies ({founderMetrics.alerts.length})</span>
                </div>

                {founderMetrics.alerts.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-4 bg-slate-950/40 border border-slate-900/30 rounded-xl">
                    ✓ All system pacing, CTR limits, and delivery conditions are in bounds.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {founderMetrics.alerts.map((alert: string, idx: number) => (
                      <div key={idx} className="flex items-start space-x-2.5 bg-red-955/10 border border-red-900/30 p-3 rounded-xl text-xs text-red-200">
                        <AlertCircle className="w-4 h-4 text-red-450 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{alert}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Right side: Pending Approvals list */}
            <div className="space-y-6">
              
              <div className="bg-slate-955/20 border border-slate-900 rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center space-x-1.5 border-b border-slate-900 pb-2">
                  <FileCheck2 className="w-4 h-4 text-indigo-400" />
                  <span>Pending approvals queue</span>
                </h3>

                {pendingApprovals?.length === 0 ? (
                  <div className="text-xs text-slate-500 py-6 text-center">
                    No pending approval records.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                    {pendingApprovals?.map((ap) => (
                      <div key={ap.id} className="bg-slate-900/25 border border-slate-900 hover:border-slate-850 p-3.5 rounded-xl transition-all space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-slate-200">{ap.clients?.name}</span>
                          <span className="text-[8.5px] uppercase bg-indigo-950 border border-indigo-900 text-indigo-400 px-1.5 py-0.5 rounded font-mono font-bold">
                            {ap.entity_type}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 line-clamp-2">{ap.feedback_text}</p>
                        <div className="pt-1">
                          <Link href="/dashboard/approvals" className="text-[9px] font-extrabold text-indigo-400 hover:text-indigo-300 flex items-center uppercase tracking-wide">
                            <span>Open Approvals Portal</span>
                            <ChevronRight className="w-3 h-3 ml-0.5" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      )}

      {/* ================= EMPLOYEE DASHBOARD ================= */}
      {role === "employee" && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center space-x-1.5">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span>My Active Task Assignments ({employeeTasks.length})</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">Review deadlines, concept creation, and client review feedbacks</p>
          </div>

          {employeeTasks.length === 0 ? (
            <div className="bg-slate-950/40 border border-slate-900 p-12 text-center rounded-3xl text-xs text-slate-500">
              No tasks assigned to your profile. View tasks board to allocate slots.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {employeeTasks.map((t) => {
                const isOverdue = new Date(t.deadline) < new Date() && t.status !== "done";
                return (
                  <div key={t.id} className="bg-slate-955/20 border border-slate-900 rounded-2xl p-5 space-y-4 hover:border-slate-850 transition-colors flex flex-col justify-between text-xs">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <span className="font-extrabold text-slate-200">{t.plan?.clients?.name || "Client"}</span>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider ${
                          t.status === "review"
                            ? "bg-amber-955/20 text-amber-400 border border-amber-900/50"
                            : t.status === "in_progress"
                            ? "bg-blue-955/20 text-blue-400 border border-blue-900/50"
                            : "bg-slate-905 text-slate-400"
                        }`}>
                          {t.status}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Assignment Category</div>
                        <h4 className="font-extrabold text-white text-sm capitalize">{t.type} Production</h4>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-900/60 flex items-center justify-between">
                      <span className={`flex items-center space-x-1 font-mono text-[10px] font-bold ${
                        isOverdue ? "text-red-400 animate-pulse" : "text-slate-500"
                      }`}>
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Due: {new Date(t.deadline).toLocaleDateString()}</span>
                      </span>

                      <Link href="/dashboard/production" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg text-[9px] uppercase tracking-wider transition-all">
                        Edit Card
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* ================= CLIENT DASHBOARD ================= */}
      {role === "client" && (
        <div className="space-y-8 animate-fade-in">
          
          {clientData.clientObj ? (
            <>
              {/* Ad Stats Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ad Spend (All Time)</p>
                  <h3 className="text-2xl font-extrabold text-white">Rs. {clientData.totalSpend}</h3>
                  <p className="text-[9px] text-slate-550">Meta Marketing API sync</p>
                </div>
                
                <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Impressions</p>
                  <h3 className="text-2xl font-extrabold text-white">
                    {clientData.totalImpressions > 1000 
                      ? `${(clientData.totalImpressions / 1000).toFixed(1)}k`
                      : clientData.totalImpressions
                    }
                  </h3>
                  <p className="text-[9px] text-slate-550">Brand awareness visibility</p>
                </div>

                <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Conversions / Leads</p>
                  <h3 className="text-2xl font-extrabold text-white">{clientData.totalLeads}</h3>
                  <p className="text-[9px] text-emerald-450 font-bold">Cost per conversion: Rs. {
                    clientData.totalLeads > 0 
                      ? (clientData.totalSpend / clientData.totalLeads).toFixed(1) 
                      : 0
                  }</p>
                </div>

                <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Published Posts</p>
                  <h3 className="text-2xl font-extrabold text-white">{clientData.publishedCount}</h3>
                  <p className="text-[9px] text-slate-550">Live assets distributed</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Left: Content Calendar & pillars */}
                <div className="lg:col-span-2 space-y-6">
                  
                  <div className="bg-slate-955/20 border border-slate-900 rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-1.5 border-b border-slate-900 pb-2">
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      <span>This Month&apos;s Content Calendar</span>
                    </h3>

                    {clientData.latestPlan ? (
                      <div className="space-y-4 text-xs">
                        <div className="bg-slate-900/10 border border-slate-900/45 p-4 rounded-xl space-y-2">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Strategy Direction Summary</span>
                          <p className="text-slate-300 leading-relaxed font-semibold">{clientData.latestPlan.strategy_summary}</p>
                        </div>

                        <div className="space-y-2">
                          <span className="text-[10px] text-slate-500 uppercase font-mono">Calendar Slots</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(clientData.latestPlan.content_calendar as Record<string, string>[] || []).slice(0, 4).map((slot, index) => (
                              <div key={index} className="bg-slate-950/40 border border-slate-900 p-3 rounded-xl space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="font-mono text-[9px] text-slate-500">{slot.date}</span>
                                  <span className="text-[8px] uppercase bg-slate-900 px-1 py-0.5 rounded text-slate-400 font-bold">{slot.format}</span>
                                </div>
                                <p className="text-slate-300 font-medium line-clamp-2">{slot.concept}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-550 py-4 text-center">
                        No active monthly plan strategy defined.
                      </div>
                    )}
                  </div>

                </div>

                {/* Right: Published Posts List */}
                <div className="space-y-6">
                  
                  <div className="bg-slate-955/20 border border-slate-900 rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-1.5 border-b border-slate-900 pb-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Recently Published Assets</span>
                    </h3>

                    {clientData.recentPublished.length === 0 ? (
                      <div className="text-xs text-slate-500 py-6 text-center">
                        No published creatives found.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {clientData.recentPublished.map((cr) => (
                          <div key={cr.id} className="bg-slate-950/40 border border-slate-900 p-3 rounded-xl space-y-1.5 text-xs">
                            <div className="flex justify-between items-center text-[9px] font-mono text-slate-500">
                              <span>Published: {new Date(cr.published_at).toLocaleDateString()}</span>
                              <span className="uppercase text-slate-400">{cr.type}</span>
                            </div>
                            <p className="text-slate-200 font-bold line-clamp-1">{cr.caption}</p>
                            {cr.media_url && (
                              <div className="pt-1">
                                <a href={cr.media_url} target="_blank" rel="noopener noreferrer" className="text-[9.5px] font-extrabold text-indigo-400 hover:underline uppercase">
                                  View Live Post
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </>
          ) : (
            <div className="bg-slate-950/40 border border-slate-900 p-12 text-center rounded-3xl text-xs text-slate-500">
              No matching client profile found for brand: {brandName}
            </div>
          )}

        </div>
      )}

      {/* ================= Console Workspace Modules ================= */}
      {role !== "client" && (
        <div className="space-y-6 pt-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Console Workspace Modules</h2>
            <p className="text-xs text-slate-550 mt-1">Select a module to view status or execute operations</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {role === "founder" && (
              <Link href="/dashboard/onboarding" className="group">
                <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-emerald-400 border-emerald-950/30 bg-emerald-950/5`}>
                  <div className="space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                      <Users className="w-5 h-5 text-emerald-400" />
                    </div>
                    <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">Client Onboarding</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">Register new brands, gather marketing assets, guidelines, and target goals.</p>
                  </div>
                  <div className="mt-6 flex items-center text-xs font-bold text-emerald-400 group-hover:text-emerald-300 transition-colors">
                    <span>Open Module</span>
                    <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            )}

            <Link href="/dashboard/brand-brain" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-indigo-400 border-indigo-950/30 bg-indigo-950/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <Award className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-indigo-400 transition-colors">Brand Brain</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Central intelligence profile containing brand voice guidelines, colors, visual assets, and feedback logs.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-indigo-400 group-hover:text-indigo-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/planning" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-sky-400 border-sky-950/30 bg-sky-950/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <ListTodo className="w-5 h-5 text-sky-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-sky-400 transition-colors">Campaign Planning</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Generate ad scripts, visual content calendars, and outline concepts for video production.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-sky-400 group-hover:text-sky-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/approvals" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-amber-400 border-amber-955/20 bg-amber-955/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <FileCheck2 className="w-5 h-5 text-amber-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-amber-400 transition-colors">Approvals Flow</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Manage approval lifecycle for strategy plans and creatives between founders and clients.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-amber-400 group-hover:text-amber-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/production" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-purple-400 border-purple-950/30 bg-purple-950/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <Video className="w-5 h-5 text-purple-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-purple-400 transition-colors">Ad Production</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Orchestrate task boards, deadlines, asset uploads, and automated QC checks.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-purple-400 group-hover:text-purple-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/publishing" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-pink-400 border-pink-955/20 bg-pink-955/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <ChevronRight className="w-5 h-5 rotate-270 text-pink-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-pink-400 transition-colors">Ad Publishing</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Schedule posts and publish approved assets automatically to Facebook Page and Instagram Business.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-pink-400 group-hover:text-pink-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/ads" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-blue-400 border-blue-950/30 bg-blue-950/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-blue-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition-colors">Meta Ads Manager</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Deploy paused campaigns, configure target audience recommendations, and setup Autopilot optimization rules.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-blue-400 group-hover:text-blue-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

            <Link href="/dashboard/reporting" className="group">
              <div className={`h-full border border-slate-900 hover:border-slate-805 rounded-2xl p-6 transition-all duration-300 hover:bg-slate-900/10 hover:shadow-lg flex flex-col justify-between text-rose-400 border-rose-955/20 bg-rose-955/5`}>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-center">
                    <Eye className="w-5 h-5 text-rose-400" />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-rose-400 transition-colors">Reporting & Analytics</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Aggregate performance statistics, review weekly PDF summaries, manage TBW prospects CRM pipeline, and sync learning loops.</p>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-rose-400 group-hover:text-rose-300 transition-colors">
                  <span>Open Module</span>
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>

          </div>
        </div>
      )}

    </div>
  );
}
