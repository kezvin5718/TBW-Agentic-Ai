"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  Briefcase,
  AlertTriangle,
  Wand2,
  Upload
} from "lucide-react";

export default function PlanningIndexPage() {
  interface ClientListItem {
    id: string;
    name: string;
    deliverables_per_month: number;
    ad_budget: number;
  }

  interface PlanListItem {
    id: string;
    month: string;
    status: string;
    strategy_summary: string | null;
    clients: { name: string } | null;
  }

  // The last six fields are carried through the wizard but not edited here —
  // they are the author's own caption and art direction, and the creative
  // pipeline reads them. Rebuilding a row without them is what used to strip
  // the plan back to a bare concept between import and save.
  interface CalendarSlot {
    date: string;
    platform: string;
    format: string;
    concept: string;
    hook: string;
    CTA: string;
    time?: string;
    caption?: string;
    slideCopy?: string[];
    productionNote?: string;
    hashtags?: string;
    complianceNote?: string;
  }

  interface BudgetAllocation {
    objective: string;
    percentage: number;
    amount: number;
    rationale: string;
  }

  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state machine
  const [wizardStep, setWizardStep] = useState(0); // 0: Config, 1: Strategy, 2: Calendar, 3: Budget
  const [generating, setGenerating] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState("");

  // Step 0 states
  const [selectedClient, setSelectedClient] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("2026-08-01");

  // Step 1 states (Strategy)
  const [strategySummary, setStrategySummary] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [pillarInput, setPillarInput] = useState("");

  // Step 2 states (Calendar)
  const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);
  // What the importer actually managed to read, said out loud.
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);
  // The Style Library shelf this plan is imported under. Empty = the client's
  // own default. It rides along with the import and is stored on the plan, so
  // 5b designs every prompt under the style chosen here.
  const [importStyle, setImportStyle] = useState<string>("");
  // Colours for this month, typed as the founder has them to hand. Whatever
  // isn't a colour code is dropped rather than guessed at, and what survives
  // is shown back as chips before anything is saved.
  const [importColors, setImportColors] = useState<string>("");
  // What the plan's own production notes demand, read at import.
  const [artDirection, setArtDirection] = useState<{ directed: number; sample: string[]; darkCount: number; styleClash: string | null } | null>(null);
  // Plan promises N, contract says M — shown until acted on or dismissed.
  const [deliverableGap, setDeliverableGap] = useState<{ clientId: string; clientName: string; planned: number; contract: number; breakdown: string } | null>(null);
  const [gapSaving, setGapSaving] = useState(false);

  // --- What the plan still needs before it can be produced --------------------
  // Colours absent from the brand brain are silently replaced with "tasteful
  // neutrals" downstream, and an unfilled [STORE ADDRESS] becomes literal text
  // on a post. Both are invisible failures, so they are asked about instead.
  interface PlanNeeds {
    placeholders: Array<{ token: string; dates: string[] }>;
    openQuestions: string[];
    brandGaps: { colors: boolean; fonts: boolean; brandBrief: boolean };
  }
  const [needs, setNeeds] = useState<PlanNeeds | null>(null);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [colorDraft, setColorDraft] = useState<string[]>([]);
  const [fontDraft, setFontDraft] = useState("");
  const [savingNeeds, setSavingNeeds] = useState(false);

  const needsAnything = (n: PlanNeeds | null) =>
    !!n && (n.placeholders.length > 0 || n.openQuestions.length > 0 || n.brandGaps.colors || n.brandGaps.fonts);

  /** Colour codes out of whatever was typed — a missing "#" is forgiven, anything else is dropped. */
  const parsePalette = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((token) => (token.startsWith("#") ? token : `#${token}`))
      .filter((token) => /^#[0-9a-fA-F]{6}$/.test(token));

  /** Put the answers into the rows and the brand brain, then close the panel. */
  const resolveNeeds = async () => {
    setSavingNeeds(true);
    setError(null);
    try {
      const colors = colorDraft.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
      const fonts = fontDraft.split(",").map((f) => f.trim()).filter(Boolean);
      if (colors.length || fonts.length) {
        await fetch("/api/planning/brand-gaps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: selectedClient, colors, fonts }),
        });
      }

      // Substitute answered placeholders everywhere they appear. Unanswered
      // ones are left in place on purpose — a visible [STORE ADDRESS] in the
      // draft is far safer than an address quietly invented to fill the hole.
      const answered = Object.entries(fills).filter(([, v]) => v.trim());
      if (answered.length) {
        const swap = (s?: string) =>
          answered.reduce((acc, [token, value]) => acc.split(token).join(value.trim()), s || "");
        setCalendarSlots((rows) =>
          rows.map((r) => ({
            ...r,
            hook: swap(r.hook),
            concept: swap(r.concept),
            CTA: swap(r.CTA),
            caption: swap(r.caption),
            productionNote: swap(r.productionNote),
            slideCopy: Array.isArray(r.slideCopy) ? r.slideCopy.map((s) => swap(s)) : r.slideCopy,
          }))
        );
      }

      const left = (needs?.placeholders.length || 0) - answered.length;
      setImportNote({
        ok: left === 0,
        text: left === 0
          ? "All blanks filled. Brand details saved — you won't be asked again for this client."
          : `${answered.length} filled, ${left} still blank. Those stay visible in the rows rather than being guessed at.`,
      });
      setNeeds(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save those details");
    } finally { setSavingNeeds(false); }
  };
  const [qtyStatic, setQtyStatic] = useState(0);
  const [qtyReel, setQtyReel] = useState(0);
  const [qtyCarousel, setQtyCarousel] = useState(0);

  // Step 3 states (Budget)
  const [budgetAllocations, setBudgetAllocations] = useState<BudgetAllocation[]>([]);

  // Deleting a plan is founder-only on the API; the button follows the same rule.
  const [isFounder, setIsFounder] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const { data: { user } } = await createClient().auth.getUser();
      setIsFounder((user?.user_metadata?.role as string) === "founder");
    })();
  }, []);

  const deletePlan = async (planId: string, label: string) => {
    if (!window.confirm(`Delete ${label}?\n\nThe plan and its calendar are removed. Creatives already generated from it stay in Creative Approvals. This cannot be undone.`)) return;
    setDeletingPlan(planId);
    setError(null);
    try {
      const res = await fetch(`/api/planning/${planId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete the plan");
      await fetchIndexData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete the plan");
    } finally { setDeletingPlan(null); }
  };

  const fetchIndexData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Let's use supabase client directly on client side!
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, name, deliverables_per_month, ad_budget")
        .is("archived_at", null)
        .order("name");

      const { data: plansData } = await supabase
        .from("monthly_plans")
        .select("id, month, status, strategy_summary, clients(name)")
        .order("month", { ascending: false });

      setClients((clientsData as unknown as ClientListItem[]) || []);
      setPlans((plansData as unknown as PlanListItem[]) || []);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to load plans list. Ensure migrations have been applied.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndexData();
  }, [fetchIndexData]);

  useEffect(() => {
    if (selectedClient) {
      const clientObj = clients.find(c => c.id === selectedClient);
      const total = clientObj?.deliverables_per_month || 10;
      const reels = Math.max(0, Math.floor(total * 0.6));
      const carousels = Math.max(0, Math.floor(total * 0.2));
      const statics = Math.max(0, total - reels - carousels);
      setQtyReel(reels);
      setQtyCarousel(carousels);
      setQtyStatic(statics);
    }
  }, [selectedClient, clients]);

  const handleStartWizard = () => {
    if (clients.length === 0) {
      setError("Please onboard at least one client before generating a plan.");
      return;
    }
    setSelectedClient(clients[0].id);
    setWizardStep(0);
    setCreating(true);
    setError(null);
  };

  // Step 1 Trigger: Generate Strategy summary
  const triggerGenerateStrategy = async () => {
    setGenerating(true);
    setLoaderMessage("AI Strategy Bot: Digesting brand briefs, past creative feedback logs, and market results...");
    setError(null);

    try {
      const response = await fetch("/api/planning/generate-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate strategy");
      }

      setStrategySummary(data.strategySummary);
      setPillars(data.contentPillars || []);
      setWizardStep(1);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate monthly strategy.");
    } finally {
      setGenerating(false);
    }
  };

  // Add/Remove Content pillars manually
  const handleAddPillar = () => {
    if (pillarInput.trim() && !pillars.includes(pillarInput.trim())) {
      setPillars([...pillars, pillarInput.trim()]);
      setPillarInput("");
    }
  };

  const handleRemovePillar = (idx: number) => {
    setPillars(pillars.filter((_, i) => i !== idx));
  };

  // Step 2 Trigger: Generate Content calendar slots
  const triggerGenerateCalendar = async () => {
    // Generating does not read the uploaded file — it only gets the strategy
    // summary and a count, so it returns invented rows. Losing a real imported
    // calendar to it is silent and unrecoverable, hence the stop.
    const authored = calendarSlots.filter((s) => (s.productionNote || s.caption || "").trim()).length;
    if (calendarSlots.length > 0) {
      const detail = authored > 0
        ? `${authored} of them carry your own production direction from the imported plan, which cannot be recovered.`
        : "These will be replaced by AI-written slots.";
      if (!window.confirm(`This replaces all ${calendarSlots.length} calendar slots with newly generated ones.\n\n${detail}\n\nIf you imported a plan, press Cancel and use "Keep my slots" instead.\n\nReplace them?`)) return;
    }

    setGenerating(true);
    setLoaderMessage("AI Production Bot: Formulating hooks, body concepts, CTAs and distributing dates...");
    setError(null);

    try {
      const response = await fetch("/api/planning/generate-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          strategySummary,
          contentPillars: pillars,
          qtyStatic,
          qtyReel,
          qtyCarousel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate content calendar");
      }

      setCalendarSlots(data.calendar || []);
      setWizardStep(2);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate calendar slots.");
    } finally {
      setGenerating(false);
    }
  };

  // Edit calendar fields in wizard
  const handleCalendarChange = (index: number, field: string, value: string) => {
    const updated = [...calendarSlots];
    updated[index] = { ...updated[index], [field]: value };
    setCalendarSlots(updated);
  };

  const handleRemoveCalendarSlot = (index: number) => {
    setCalendarSlots(calendarSlots.filter((_, i) => i !== index));
  };

  const handleAddCalendarSlot = () => {
    setCalendarSlots([
      ...calendarSlots,
      {
        date: selectedMonth,
        platform: "instagram",
        format: "reel",
        concept: "New Promo Concept",
        hook: "Intriguing opener",
        CTA: "Shop now",
      },
    ]);
  };

  // Step 3 Trigger: Generate Budget Splits
  const triggerGenerateBudget = async () => {
    // The step numbers along the top are clickable, so this step is reachable
    // before a strategy exists. Say what is missing here rather than letting the
    // server reject it with a list of four field names.
    if (!selectedClient || !selectedMonth) {
      setError("Pick a client and a month before generating the budget.");
      return;
    }
    if (!strategySummary.trim()) {
      setError("There's no strategy summary yet — go back to step 1 (or import a plan) before generating the budget.");
      return;
    }
    setGenerating(true);
    setLoaderMessage("AI Media Planner: Optimizing ad budget allocation across conversion, leads and engagement objectives...");
    setError(null);

    const clientObj = clients.find((c) => c.id === selectedClient);
    const budgetVal = clientObj ? clientObj.ad_budget : 100000;

    try {
      const response = await fetch("/api/planning/generate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          adBudget: budgetVal,
          strategySummary,
          contentCalendar: calendarSlots,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate budget allocations");
      }

      setBudgetAllocations(data.allocations || []);
      // A client with no ad budget gets an empty split rather than an error —
      // say why, or the step looks like it silently did nothing.
      if (data.note) setImportNote({ ok: true, text: data.note });
      setWizardStep(3);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate budget splits.");
    } finally {
      setGenerating(false);
    }
  };

  // Edit budget splits
  const handleBudgetChange = (index: number, field: string, value: string | number) => {
    const updated = [...budgetAllocations];
    updated[index] = { ...updated[index], [field]: value };
    setBudgetAllocations(updated);
  };

  // ---- Full-plan (GPT-4o) generation + file import -------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  interface IncomingPlan {
    strategySummary?: string;
    contentPillars?: string[];
    contentCalendar?: Array<{
      date?: string; platform?: string; format?: string; concept?: string; hook?: string; CTA?: string; cta?: string;
      time?: string; caption?: string; slideCopy?: string[]; productionNote?: string; hashtags?: string; complianceNote?: string;
    }>;
    budgetSummary?: { allocations?: BudgetAllocation[] };
  }

  const applyPlan = (plan: IncomingPlan) => {
    setStrategySummary(plan.strategySummary || "");
    setPillars(Array.isArray(plan.contentPillars) ? plan.contentPillars : []);
    const slots: CalendarSlot[] = (plan.contentCalendar || []).map((s) => ({
      date: s.date || "",
      platform: s.platform || "instagram",
      format: s.format || "static",
      concept: s.concept || "",
      hook: s.hook || "",
      CTA: s.CTA || s.cta || "",
      // Not shown in the editor, but carried to the save so the designer sees
      // the author's actual brief rather than a bare concept line.
      time: s.time || "",
      caption: s.caption || "",
      slideCopy: Array.isArray(s.slideCopy) ? s.slideCopy : [],
      productionNote: s.productionNote || "",
      hashtags: s.hashtags || "",
      complianceNote: s.complianceNote || "",
    }));
    setCalendarSlots(slots);
    setQtyStatic(slots.filter((s) => s.format === "static").length);
    setQtyReel(slots.filter((s) => s.format === "reel").length);
    setQtyCarousel(slots.filter((s) => s.format === "carousel").length);
    setBudgetAllocations(Array.isArray(plan.budgetSummary?.allocations) ? plan.budgetSummary!.allocations : []);
  };

  const handleGenerateFullPlan = async () => {
    if (!selectedClient) {
      setError("Please select a client first.");
      return;
    }
    setGenerating(true);
    setLoaderMessage("GPT-4o is drafting the complete plan — strategy, calendar and budget in one pass...");
    setError(null);
    try {
      const res = await fetch("/api/planning/generate-full-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClient, month: selectedMonth }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to generate full plan");
      applyPlan(data.plan);
      setWizardStep(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate full plan");
    } finally {
      setGenerating(false);
    }
  };

  const handleImportPlan = async (file: File) => {
    if (!selectedClient) {
      setError("Please select a client first.");
      return;
    }
    setGenerating(true);
    setLoaderMessage(`Extracting "${file.name}" with GPT-4o...`);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientId", selectedClient);
      fd.append("month", selectedMonth);
      fd.append("style", importStyle);
      const res = await fetch("/api/planning/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to import plan");
      applyPlan(data.plan);
      setArtDirection(data.artDirection || null);
      const rows = (data.plan?.contentCalendar || []).length;
      if (needsAnything(data.needs)) {
        setNeeds(data.needs);
        setFills({});
        setColorDraft(data.needs.brandGaps.colors ? ["#000000"] : []);
        setFontDraft("");
      }
      // A clean parse is saved the moment it exists. Two imports in a row were
      // lost to "surely someone will press the button" — nobody has to now.
      // The server still refuses to auto-replace a plan with authored rows,
      // so a wrong file can't quietly destroy real work.
      let savedLine = "";
      if (!data.truncated && !data.underExtracted && rows > 0) {
        try {
          const saveRes = await fetch("/api/planning/save-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: selectedClient,
              month: selectedMonth,
              strategySummary: data.plan?.strategySummary || "Imported plan",
              contentPillars: data.plan?.contentPillars || [],
              contentCalendar: data.plan?.contentCalendar || [],
              budgetSummary: data.plan?.budgetSummary || { allocations: [] },
              styleCategory: importStyle,
              colorPalette: parsePalette(importColors),
              status: "draft",
              autoImport: true,
            }),
          });
          const saveData = await saveRes.json();
          savedLine = saveRes.ok && saveData.saved
            ? " ✓ Saved to the plan — 5b can use it right now; the next steps only add budget and details."
            : ` Not saved yet: ${saveData.reason || saveData.error || "press \"Keep my slots\" to store it."}`;
        } catch {
          savedLine = " Not saved yet — press \"Keep my slots\" to store it.";
        }
      }

      setImportNote({
        // Truncation and under-extraction used to be invisible: the plan
        // simply arrived short, with nothing to say why.
        ok: !data.truncated && !data.underExtracted,
        text: data.truncated
          ? `Read ${rows} rows, but the file was too long — ${data.truncatedChars} characters at the end were not read. Split the plan into two files, or trim it, and import again.`
          : data.underExtracted
            ? `⚠ The file shows roughly ${data.dateSignals} dated entries but only ${rows} row${rows === 1 ? "" : "s"} came out — the file's structure is hiding content from the reader. Don't save this as your plan. Try: open the file in a browser → Print → Save as PDF (text), and import that instead.`
            : `Read ${rows} rows, ${data.rowsWithDirection} of them with your production direction attached.${savedLine}`,
      });
      setWizardStep(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import plan");
    } finally {
      setGenerating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const [keepSaving, setKeepSaving] = useState(false);

  /**
   * Accepting imported rows writes them to the plan immediately.
   *
   * Until now the parsed plan lived only in browser memory until the wizard's
   * final Save — anyone who imported, pressed Keep, and stopped there lost the
   * whole import without a word, and 5b went on showing whatever the plan held
   * before. The moment of acceptance is the moment of persistence.
   */
  const keepImportedSlots = async () => {
    setKeepSaving(true);
    try {
      const response = await fetch("/api/planning/save-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          strategySummary: strategySummary || "Imported plan",
          contentPillars: pillars,
          contentCalendar: calendarSlots,
          budgetSummary: { allocations: budgetAllocations },
          styleCategory: importStyle,
          colorPalette: parsePalette(importColors),
          status: "draft",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the imported slots");
      setImportNote({ ok: true, text: `Your ${calendarSlots.length} slots are saved on the plan. The remaining wizard steps only add budget and details — closing the tab now loses nothing.` });
      setWizardStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the imported slots — they are NOT stored yet.");
    } finally { setKeepSaving(false); }
  };

  // Step 4: Save plan to DB
  const handleSavePlan = async () => {
    setGenerating(true);
    setLoaderMessage("Synthesizing final dashboard structures and saving Monthly Plan draft...");
    setError(null);

    try {
      const response = await fetch("/api/planning/save-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          month: selectedMonth,
          strategySummary,
          contentPillars: pillars,
          contentCalendar: calendarSlots,
          budgetSummary: { allocations: budgetAllocations },
          status: "draft",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save monthly plan");
      }

      // Contract vs plan: a difference is a fact for the founder, not an error.
      const planned = Number(data.deliverables?.total || 0);
      const contract = Number(data.contract || 0);
      if (planned > 0 && contract > 0 && planned !== contract) {
        const d = data.deliverables || {};
        const parts = [d.posts && `${d.posts} posts`, d.carousels && `${d.carousels} carousels`, d.stories && `${d.stories} stories`, d.reels && `${d.reels} reels`].filter(Boolean).join(", ");
        setDeliverableGap({
          clientId: selectedClient,
          clientName: clients.find((c) => c.id === selectedClient)?.name || "this client",
          planned, contract, breakdown: parts,
        });
      } else {
        setDeliverableGap(null);
      }

      setCreating(false);
      fetchIndexData();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save completed plan.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Index view header */}
      {!creating && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-900 gap-4">
          <div>
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
              <Calendar className="w-4 h-4" />
              <span>Strategy Room</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Monthly Strategy Plans</h1>
            <p className="text-slate-400 text-xs mt-1">Develop content grids, pillars, and budget schedules per client</p>
          </div>

          <button
            onClick={handleStartWizard}
            className="flex items-center justify-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2.5 px-5 rounded-xl text-xs shadow-lg shadow-indigo-950/40 cursor-pointer"
          >
            <span>Create Monthly Plan</span>
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/50 text-red-200 text-xs flex items-start space-x-2">
          <span>{error}</span>
        </div>
      )}

      {deliverableGap && !creating && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/50 text-amber-200 text-xs space-y-2">
          <p className="font-bold">
            {deliverableGap.clientName}: the plan promises {deliverableGap.planned} deliverables ({deliverableGap.breakdown}) — the contract from onboarding says {deliverableGap.contract}/month
            {deliverableGap.planned < deliverableGap.contract ? ` (short by ${deliverableGap.contract - deliverableGap.planned})` : ` (${deliverableGap.planned - deliverableGap.contract} over)`}.
          </p>
          <p className="text-amber-300/70">
            Production follows the plan either way. If this month is intentional (festival month, package change), carry on — the morning brief will keep watching it. If the package itself changed, update the contract:
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={gapSaving}
              onClick={async () => {
                setGapSaving(true);
                try {
                  const res = await fetch(`/api/clients/${deliverableGap.clientId}`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "deliverables", count: deliverableGap.planned }),
                  });
                  const d = await res.json();
                  if (!res.ok) throw new Error(d.error || "Could not update");
                  setDeliverableGap(null);
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Could not update the contract");
                } finally { setGapSaving(false); }
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer disabled:opacity-50">
              {gapSaving ? "Saving…" : `Update contract to ${deliverableGap.planned}/month (founder)`}
            </button>
            <button onClick={() => setDeliverableGap(null)} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white font-bold cursor-pointer">
              Keep contract as is
            </button>
          </div>
        </div>
      )}

      {importNote && (
        <div className={`p-4 rounded-xl border text-xs flex items-start space-x-2 ${importNote.ok ? "bg-emerald-950/20 border-emerald-900/50 text-emerald-200" : "bg-amber-950/20 border-amber-900/50 text-amber-200"}`}>
          <span>{importNote.text}</span>
        </div>
      )}

      {/* The art direction the plan itself carries. Shown at import so a month
          of black teasers is a decision made here, not a surprise in the
          finished creatives. */}
      {artDirection && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Art direction in this plan</p>
          <p className="text-slate-300">
            {artDirection.directed} row{artDirection.directed === 1 ? "" : "s"} carry your production direction.
          </p>
          {artDirection.sample.length > 0 && (
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-500">
              {artDirection.sample.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
          {artDirection.styleClash && (
            <p className="text-[11px] text-amber-200">⚠ {artDirection.styleClash}</p>
          )}
        </div>
      )}

      {/* Everything here was found in the plan or is missing from the brand
          brain — nothing on this panel is invented. */}
      {needs && (
        <div className="rounded-2xl border border-indigo-900/60 bg-indigo-950/20 p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white">What I still need</h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Answer what you can and skip the rest. Anything you skip stays visible in the plan rather than being filled in with a guess.
            </p>
          </div>

          {(needs.brandGaps.colors || needs.brandGaps.fonts) && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                Brand — nothing on file, and every post for this client needs it
              </p>
              {needs.brandGaps.colors && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                    Brand colours <span className="normal-case font-medium text-slate-600">— without these the designer falls back to plain neutrals</span>
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {colorDraft.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input type="color" value={c}
                          onChange={(e) => setColorDraft((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                          className="w-9 h-9 rounded-lg bg-transparent border border-slate-800 cursor-pointer" />
                        <button type="button" onClick={() => setColorDraft((p) => p.filter((_, j) => j !== i))}
                          className="text-slate-600 hover:text-rose-400 text-xs cursor-pointer">✕</button>
                      </div>
                    ))}
                    {colorDraft.length < 6 && (
                      <button type="button" onClick={() => setColorDraft((p) => [...p, "#A8792C"])}
                        className="px-3 py-2 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-400 hover:text-white cursor-pointer">
                        + Add colour
                      </button>
                    )}
                  </div>
                </div>
              )}
              {needs.brandGaps.fonts && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Fonts <span className="normal-case font-medium text-slate-600">— comma separated</span></label>
                  <input value={fontDraft} onChange={(e) => setFontDraft(e.target.value)}
                    placeholder="e.g. Bodoni Moda, IBM Plex Sans"
                    className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none" />
                </div>
              )}
            </div>
          )}

          {needs.placeholders.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                Blanks in your plan ({needs.placeholders.length})
              </p>
              {needs.placeholders.map((p) => (
                <div key={p.token} className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-[210px]">
                    <code className="text-[11px] text-amber-300">{p.token}</code>
                    <p className="text-[10px] text-slate-600">
                      {p.dates.length > 0 ? `used on ${p.dates.join(", ")}` : "used in the plan"}
                    </p>
                  </div>
                  <input
                    value={fills[p.token] || ""}
                    onChange={(e) => setFills((f) => ({ ...f, [p.token]: e.target.value }))}
                    placeholder="leave empty to keep it blank"
                    className="flex-1 min-w-[220px] bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}

          {needs.openQuestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                Your plan flagged these as still needed
              </p>
              <ul className="space-y-1">
                {needs.openQuestions.map((q, i) => (
                  <li key={i} className="text-[11px] text-slate-300 flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span><span>{q}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-600">These are for you to chase — they aren&apos;t saved anywhere yet.</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={resolveNeeds} disabled={savingNeeds}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer disabled:opacity-50">
              {savingNeeds ? "Saving…" : "Save & continue"}
            </button>
            <button type="button" onClick={() => setNeeds(null)}
              className="py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white text-xs cursor-pointer">
              Skip for now
            </button>
          </div>
        </div>
      )}

      {creating ? (
        /* WIZARD CONTAINER */
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 md:p-8 relative">
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          {/* Stepper Header — clickable to jump between (pre-filled) steps for review */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6 text-xs text-slate-500">
            {[
              "0. Client Config",
              "1. Strategy pillars",
              "2. Calendar slots",
              "3. Spend Allocation",
            ].map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <span className="text-slate-800">/</span>}
                <button
                  type="button"
                  onClick={() => setWizardStep(i)}
                  className={`cursor-pointer hover:text-white transition-colors ${wizardStep === i ? "text-indigo-400 font-bold" : "text-slate-400"}`}
                >
                  {label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {generating ? (
            /* Generating spinner overlay */
            <div className="py-20 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              <div className="text-center space-y-1 max-w-sm">
                <p className="text-xs text-indigo-300 font-semibold animate-pulse">Consulting Strategic Engine...</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">{loaderMessage}</p>
              </div>
            </div>
          ) : (
            /* STEP CONTENT switch */
            <div className="space-y-6">
              
              {/* STEP 0: Configure client and month */}
              {wizardStep === 0 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Set Client Parameters</h3>
                    <p className="text-[10px] text-slate-500">Select target account and month duration</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Select Client</label>
                      <select
                        value={selectedClient}
                        onChange={(e) => setSelectedClient(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white focus:outline-none"
                      >
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Target Month</label>
                      <input
                        type="date"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Fast options: one-shot AI full plan (GPT-4o) or import a manual plan file */}
                  <div className="border border-slate-900 rounded-xl p-4 space-y-3 bg-indigo-950/10">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fast options — skip straight to a filled plan</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={handleGenerateFullPlan}
                        className="flex items-center justify-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer shadow-lg shadow-indigo-950/30"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Generate Full Plan (GPT-4o)</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex-1 flex items-center justify-center space-x-2 bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import Plan (HTML / PDF)</span>
                        </button>
                        {/* Chosen before the upload, because it is stored on the
                            plan and every image prompt 5b writes obeys it. */}
                        <select
                          value={importStyle}
                          onChange={(e) => setImportStyle(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                        >
                          <option value="">Style: client default</option>
                          <option value="traditional">Traditional</option>
                          <option value="modern">Modern</option>
                          <option value="surreal">Surreal</option>
                          <option value="boutique">Boutique</option>
                        </select>
                      </div>
                    </div>
                    {/* Colours stored on the plan outrank the brand brain for
                        this month — a festive week in maroon and gold is set
                        here rather than argued with afterwards. */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={importColors}
                        onChange={(e) => setImportColors(e.target.value)}
                        placeholder="#1A1A2E, #D4AF37 — colours for this plan (optional)"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] placeholder-slate-600 focus:outline-none"
                      />
                      <div className="flex items-center gap-1">
                        {parsePalette(importColors).map((hex, i) => (
                          <span
                            key={`${hex}-${i}`}
                            title={hex}
                            className="inline-block w-4 h-4 rounded border border-slate-700"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".html,.htm,.pdf,.txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImportPlan(f);
                      }}
                    />
                    <p className="text-[9px] text-slate-600 leading-relaxed">
                      <span className="text-slate-400 font-semibold">Full Plan</span> drafts everything in one GPT-4o pass.{" "}
                      <span className="text-slate-400 font-semibold">Import</span> extracts a plan you wrote yourself (text PDF or HTML). Both drop into the editable steps below for review before saving.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8">
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="text-xs text-slate-500 hover:text-white py-2 px-4 border border-slate-800 rounded-xl transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={triggerGenerateStrategy}
                      className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer shadow-lg shadow-indigo-950/30"
                    >
                      <span>Generate Strategy (step-by-step)</span>
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 1: Edit Strategy and content pillars */}
              {wizardStep === 1 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Step 1: Edit Strategy Summary</h3>
                    <p className="text-[10px] text-slate-500">Fine-tune the goals and focus pillars before generating content slots</p>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Strategy Summary & Goals</label>
                      <textarea
                        rows={6}
                        value={strategySummary}
                        onChange={(e) => setStrategySummary(e.target.value)}
                        className="w-full bg-slate-900/40 border border-slate-800 rounded-xl py-2.5 px-3.5 text-white placeholder-slate-600 focus:outline-none resize-none leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Content Pillars</label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          placeholder="e.g. Spice Heritage Stories"
                          value={pillarInput}
                          onChange={(e) => setPillarInput(e.target.value)}
                          className="bg-slate-900/40 border border-slate-800 rounded-xl py-2 px-3 text-white placeholder-slate-600 focus:outline-none flex-1"
                        />
                        <button
                          type="button"
                          onClick={handleAddPillar}
                          className="px-3 bg-indigo-950/40 border border-indigo-900 text-indigo-300 rounded-xl font-bold cursor-pointer hover:bg-indigo-900/40"
                        >
                          Add
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-3">
                        {pillars.map((pillar, idx) => (
                          <div key={idx} className="flex items-center space-x-1.5 bg-indigo-950/30 border border-indigo-900/50 py-1.5 px-2.5 rounded-lg text-[10px] font-semibold text-indigo-400">
                            <span>{pillar}</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePillar(idx)}
                              className="text-indigo-600 hover:text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Format Quantity Planner */}
                  <div className="space-y-4 pt-4 border-t border-slate-900/60">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Format Quantity Planner</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Specify the quantities per format to pre-tag calendar slots upon generation</p>
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Static Posts</label>
                        <input
                          type="number"
                          min="0"
                          value={qtyStatic}
                          onChange={(e) => setQtyStatic(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-slate-900/45 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Reels</label>
                        <input
                          type="number"
                          min="0"
                          value={qtyReel}
                          onChange={(e) => setQtyReel(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-slate-900/45 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Carousels</label>
                        <input
                          type="number"
                          min="0"
                          value={qtyCarousel}
                          onChange={(e) => setQtyCarousel(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-slate-900/45 border border-slate-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Reconciliation & Mismatch warnings */}
                    {(() => {
                      const clientObj = clients.find(c => c.id === selectedClient);
                      // 0 / unset means "no contract number recorded" — there is
                      // nothing to compare against, so say that instead of
                      // flagging a mismatch with zero.
                      const targetVal = Number(clientObj?.deliverables_per_month || 0);
                      const sumVal = Number(qtyStatic) + Number(qtyReel) + Number(qtyCarousel);
                      // With an imported calendar in hand, the real number is
                      // its slot count — the quantity boxes only matter on the
                      // "Replace with AI slots" path. Comparing the contract to
                      // untouched zero boxes cried mismatch at every import.
                      const imported = calendarSlots.length;
                      const effective = imported > 0 ? imported : sumVal;
                      const hasMismatch = targetVal > 0 && effective !== targetVal;

                      return (
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 bg-slate-950/20 border border-slate-900 p-2.5 rounded-lg">
                            <span>{imported > 0
                              ? <>Your imported plan: <strong className="text-white">{imported} slots</strong><span className="text-slate-600"> (quantity boxes only apply if you replace with AI slots)</span></>
                              : <>Total Scheduled Posts: <strong className="text-white">{sumVal}</strong></>}</span>
                            <span>{targetVal > 0
                              ? <>Contract: <strong className="text-white">{targetVal}/month</strong></>
                              : <span className="text-slate-600">No contract number set for this client — the plan is the only truth.</span>}</span>
                          </div>
                          {hasMismatch && (
                            <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 flex items-start space-x-2 text-[10px] text-amber-300 font-semibold animate-in fade-in duration-200">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold text-white">Plan differs from the contract</p>
                                <p className="font-normal mt-0.5">{imported > 0 ? `Your imported plan has ${imported} slots` : `These quantities add to ${sumVal}`}; the contract from onboarding says {targetVal}/month. Production follows the plan — this is only a heads-up, you&apos;ll get a reconcile option when you save, and the morning brief keeps watching it.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(0)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <div className="flex items-center space-x-2">
                      {/* An imported calendar is the author's own work. Generating
                          replaces every row with invented ones, and this used to
                          be the only way forward from this step — so a plan read
                          correctly from a file was overwritten on the way past. */}
                      {calendarSlots.length > 0 && (
                        <button
                          type="button"
                          disabled={keepSaving}
                          onClick={keepImportedSlots}
                          className="flex items-center space-x-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer disabled:opacity-60"
                        >
                          {keepSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          <span>{keepSaving ? "Saving your slots…" : `Keep my ${calendarSlots.length} slots`}</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={triggerGenerateCalendar}
                        className={`flex items-center space-x-1 font-bold py-2 px-4 rounded-xl cursor-pointer ${
                          calendarSlots.length > 0
                            ? "border border-slate-800 text-slate-400 hover:text-white"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white"
                        }`}
                      >
                        <span>{calendarSlots.length > 0 ? "Replace with AI slots" : "Generate Calendar"}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Edit Content Calendar */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">Step 2: Edit Content Calendar</h3>
                      <p className="text-[10px] text-slate-500">Edit concept themes, dates, hooks, or add new deliverable slots</p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddCalendarSlot}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-900 text-[10px] font-bold text-indigo-300 hover:bg-indigo-900/40 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Slot</span>
                    </button>
                  </div>

                  {(() => {
                    const clientObj = clients.find(c => c.id === selectedClient);
                    const targetVal = Number(clientObj?.deliverables_per_month || 0);
                    const hasMismatch = targetVal > 0 && calendarSlots.length !== targetVal;

                    if (!hasMismatch) return null;
                    return (
                      <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 flex items-start space-x-2 text-[10px] text-amber-300 font-semibold animate-in fade-in duration-200">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-white">Plan differs from the contract</p>
                          <p className="font-normal mt-0.5">This plan has {calendarSlots.length} slots; the contract from onboarding says {targetVal}/month. Production follows the plan — you&apos;ll get a reconcile option when you save.</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                    {calendarSlots.map((slot, idx) => (
                      <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4.5 space-y-3.5 relative">
                        <button
                          type="button"
                          onClick={() => handleRemoveCalendarSlot(idx)}
                          className="absolute top-4 right-4 text-slate-600 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Date</label>
                            <input
                              type="date"
                              value={slot.date}
                              onChange={(e) => handleCalendarChange(idx, "date", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Platform</label>
                            <select
                              value={slot.platform}
                              onChange={(e) => handleCalendarChange(idx, "platform", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            >
                              <option value="instagram">Instagram</option>
                              <option value="facebook">Facebook</option>
                              <option value="youtube">YouTube</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Format</label>
                            <select
                              value={slot.format}
                              onChange={(e) => handleCalendarChange(idx, "format", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            >
                              <option value="reel">Reel Video</option>
                              <option value="carousel">Carousel</option>
                              <option value="static">Static Image</option>
                            </select>
                          </div>
                        </div>

                        <div className="text-xs space-y-2">
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Concept Concept</label>
                            <input
                              type="text"
                              value={slot.concept}
                              onChange={(e) => handleCalendarChange(idx, "concept", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Intro Hook</label>
                              <textarea
                                rows={2}
                                value={slot.hook}
                                onChange={(e) => handleCalendarChange(idx, "hook", e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Call-To-Action (CTA)</label>
                              <textarea
                                rows={2}
                                value={slot.CTA}
                                onChange={(e) => handleCalendarChange(idx, "CTA", e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <button
                      type="button"
                      onClick={triggerGenerateBudget}
                      className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl cursor-pointer"
                    >
                      <span>Allocate Budget</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Edit Budget Allocations */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Step 3: Edit Budget splits</h3>
                    <p className="text-[10px] text-slate-500">Fine-tune spend ratios across campaign objectives</p>
                  </div>

                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 text-xs">
                    {budgetAllocations.map((alloc, idx) => (
                      <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4 space-y-3.5">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Objective</label>
                            <input
                              type="text"
                              value={alloc.objective}
                              onChange={(e) => handleBudgetChange(idx, "objective", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Percentage (%)</label>
                            <input
                              type="number"
                              value={alloc.percentage}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const totalBudget = clients.find(c => c.id === selectedClient)?.ad_budget || 100000;
                                handleBudgetChange(idx, "percentage", val);
                                handleBudgetChange(idx, "amount", (val / 100) * totalBudget);
                              }}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Rationale</label>
                          <textarea
                            rows={2}
                            value={alloc.rationale}
                            onChange={(e) => handleBudgetChange(idx, "rationale", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-[10px] focus:outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-slate-900 mt-8 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="flex items-center space-x-1 py-2 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={handleSavePlan}
                      className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2.5 px-5 rounded-xl cursor-pointer"
                    >
                      <span>Finalize & Save Draft</span>
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      ) : (
        /* PLANS INDEX LIST */
        <div className="space-y-4">
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-2">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <span className="text-[10px] text-slate-500 font-medium">Loading Monthly Plans...</span>
            </div>
          ) : plans.length === 0 ? (
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Briefcase className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-300">No Monthly Plans</h3>
                <p className="text-xs text-slate-500 mt-1">Select the create button above to draft your first client plan.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {plans.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/dashboard/planning/${plan.id}`}
                  className="group bg-slate-950/40 border border-slate-900 hover:border-slate-800 rounded-xl p-4.5 flex items-center justify-between transition-all"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors text-sm">
                        {plan.clients?.name || "Client"}
                      </h4>
                      <span className="text-[10px] text-slate-500 font-mono">
                        ({new Date(plan.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })})
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-1 max-w-[500px]">
                      {plan.strategy_summary?.replace(/Goals:|Central Focus:/g, "") || "No strategy summary drafted."}
                    </p>
                  </div>

                  <div className="flex items-center space-x-3.5 text-xs">
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                      plan.status === "approved" || plan.status === "internal_review"
                        ? "bg-emerald-950/40 border border-emerald-900 text-emerald-400"
                        : plan.status === "rejected"
                        ? "bg-red-950/40 border border-red-900 text-red-400"
                        : "bg-slate-900 border border-slate-800 text-slate-400"
                    }`}>
                      {plan.status === "internal_review" ? "Int. Approved" : plan.status}
                    </span>
                    {isFounder && (
                      <button
                        type="button"
                        disabled={deletingPlan === plan.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deletePlan(plan.id, `${plan.clients?.name || "this client"}'s ${new Date(plan.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} plan`);
                        }}
                        title="Delete this monthly plan (founder only)"
                        className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 cursor-pointer disabled:opacity-40"
                      >
                        {deletingPlan === plan.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
