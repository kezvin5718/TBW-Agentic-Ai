import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_CHATGPT } from "@/lib/llm-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A row of the plan.
 *
 * The first six fields are all this used to carry, and that was the reason
 * generated creative never resembled the plan: a hand-written plan says "pure
 * black frame, one point of light travelling across a single facet, no logo" —
 * the actual art direction — and there was nowhere to put it, so it was dropped
 * at the door and the designer downstream invented its own concept instead.
 */
interface CalendarSlot {
  date: string;
  platform: string;
  format: string;
  concept: string;
  hook: string;
  CTA: string;
  /** Time of day the author wants it posted, as written ("7:30 PM"). */
  time?: string;
  /** The caption to publish, verbatim, newlines intact. */
  caption?: string;
  /** Per-slide copy for a carousel, in order. */
  slideCopy?: string[];
  /** The author's art direction. Binding, not a suggestion. */
  productionNote?: string;
  /** Hashtags exactly as written. */
  hashtags?: string;
  /** Legal/compliance warnings attached to this post, if any. */
  complianceNote?: string;
}
interface Allocation {
  objective: string;
  percentage: number;
  amount: number;
  rationale: string;
}
interface FullPlan {
  strategySummary: string;
  contentPillars: string[];
  contentCalendar: CalendarSlot[];
  budgetSummary: { allocations: Allocation[] };
  /** Anything the author flagged as still missing, unconfirmed or blocking. */
  openQuestions: string[];
}

/**
 * A gap in the plan the author left for themselves — "[STORE ADDRESS — insert]".
 *
 * Left alone these quietly become literal text on a post, or vanish into a
 * generated headline. Surfacing them turns a silent defect into a question.
 */
interface Placeholder {
  token: string;
  dates: string[];
}

/** Bracketed fill-me-in markers, e.g. [STORE ADDRESS — insert] or [X] pieces. */
function findPlaceholders(rows: CalendarSlot[]): Placeholder[] {
  const hits = new Map<string, Set<string>>();
  for (const r of rows) {
    const text = [r.hook, r.caption, r.productionNote, r.CTA, r.concept, ...(r.slideCopy || [])]
      .filter(Boolean)
      .join("\n");
    // One character is enough — "[X] pieces" is a real blank, and a missed one
    // is printed onto a post verbatim. A spurious question costs nothing.
    const re = /\[([^[\]]{1,60})\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Keep the brackets — the whole token is what gets substituted later.
      if (!hits.has(m[0])) hits.set(m[0], new Set());
      if (r.date) hits.get(m[0])!.add(r.date);
    }
  }
  return Array.from(hits.entries())
    .map(([token, dates]) => ({ token, dates: Array.from(dates).sort() }))
    .sort((a, b) => b.dates.length - a.dates.length);
}

/**
 * How much plan text goes to the model in one pass. Anything longer is split
 * rather than cut: the old flat 20k cap silently dropped the tail of a real
 * 24k-character plan — the last days, the production list and the whole paid
 * layer — with nothing in the UI to say so.
 */
// 18k in one pass proved too greedy: a dense chunk carrying verbatim captions
// can need more output tokens than the model may produce, the JSON stops
// mid-array, and that whole chunk's days quietly become zero rows. Smaller
// bites keep every answer comfortably inside the output ceiling.
const CHUNK_CHARS = 10000;
/** A ceiling so a pathological upload can't fan out into dozens of calls. */
const MAX_CHUNKS = 10;

/**
 * Split on blank lines so a single day's entry is never cut in half.
 *
 * `complete` is reported explicitly rather than inferred by comparing character
 * counts: splitting consumes the blank lines between blocks, so the parts are
 * always a few characters shorter than the source even when nothing was lost.
 * Content is only ever dropped by running out of chunks.
 */
function splitForModel(text: string): { parts: string[]; complete: boolean } {
  if (text.length <= CHUNK_CHARS) return { parts: [text], complete: true };
  const blocks = text.split(/\n\s*\n/);
  const parts: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > CHUNK_CHARS && current) {
      parts.push(current);
      current = block;
      if (parts.length >= MAX_CHUNKS) return { parts, complete: false };
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return { parts, complete: true };
}

/**
 * One format per row, decided the same way every time.
 *
 * "Static / 10-sec Reel" means the author will accept either — and a static is
 * the one this pipeline can actually produce today, so static wins whenever
 * both are on the table. Carousel outranks everything because slide copy only
 * makes sense as a carousel.
 */
function normalizeFormat(raw: unknown): string {
  const f = String(raw || "").toLowerCase();
  if (f.includes("carousel")) return "carousel";
  if (f.includes("static") || f.includes("image") || f.includes("photo") || f.includes("post only")) return "static";
  if (/reel|video|film|bts|ugc|live/.test(f)) return "reel";
  return "static";
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Table cells keep a visible separator — without it a calendar table
    // mashes each row's date, hook and caption into one undifferentiated line.
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Parse the model's JSON, salvaging a truncated answer instead of discarding
 * it. An output that hits the token ceiling stops mid-array — cutting back to
 * the last complete object and closing the brackets recovers every finished
 * row, where the old behaviour returned an empty calendar for the chunk.
 */
function parseWithRepair(raw: string, fallback: FullPlan): FullPlan {
  const direct = safeJsonParse<FullPlan>(raw, fallback);
  if (Array.isArray(direct.contentCalendar) && direct.contentCalendar.length > 0) return direct;

  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  for (let cut = cleaned.lastIndexOf("}"); cut > 0; cut = cleaned.lastIndexOf("}", cut - 1)) {
    const head = cleaned.slice(0, cut + 1);
    for (const tail of ["]}", "]}}", "}]}", "]}]}"]) {
      try {
        const candidate = JSON.parse(head + tail) as FullPlan;
        if (Array.isArray(candidate.contentCalendar) && candidate.contentCalendar.length > 0) return candidate;
      } catch { /* try the next closer */ }
    }
    // Only walk back a bounded distance — beyond that the answer is junk.
    if (cleaned.length - cut > 4000) break;
  }
  return direct;
}

/** Notes that ask for a black or near-black frame. */
const DARK_DIRECTION = /black|dark|charcoal|noir|moody/i;

/**
 * One word for what each Style Library shelf looks like, used only to say why
 * a chosen style and the plan's own notes disagree. A shelf whose word is
 * itself dark can't clash with a dark note, so it never raises the warning.
 */
const STYLE_TONE: Record<string, string> = {
  traditional: "warm",
  modern: "bright",
  surreal: "moody",
  boutique: "warm",
};

/** Rough count of how many dated entries the author's file visibly contains. */
function countDateSignals(text: string): number {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,                                        // 2026-08-05
    /\b\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?\b/g,                     // 5/8, 05.08.2026
    /\b\d{1,2}\s?(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, // 5 Aug
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi,                    // Aug 5
    /\bday\s*[-#]?\s*\d{1,2}\b/gi,                                   // Day 12
  ];
  let count = 0;
  for (const re of patterns) count = Math.max(count, (text.match(re) || []).length);
  return count;
}

/**
 * POST /api/planning/import  (multipart: file, clientId, month)
 * Extracts a manually-authored plan from an uploaded HTML / PDF / TXT / MD file, then
 * uses ChatGPT (GPT-4o) via OpenRouter to structure it into the plan JSON shape.
 * Does NOT persist — the UI loads it into the editable wizard for review, then saves.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (user.user_metadata?.role as string) || "client";
    if (role !== "founder" && role !== "employee") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const clientId = form.get("clientId") as string | null;
    const month = form.get("month") as string | null;
    // The Style Library shelf the founder picked before uploading. Nothing is
    // generated from it here — it is only compared against what the plan's own
    // notes demand, so a clash is found now rather than in the creatives.
    const style = ((form.get("style") as string | null) || "").trim();
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!clientId || !month) return NextResponse.json({ error: "clientId and month are required" }, { status: 400 });

    const name = (file.name || "").toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (name.endsWith(".pdf")) {
      try {
        // Import the internal entry to avoid pdf-parse's debug harness.
        const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
        const parsed = await pdfParse(buffer);
        text = parsed.text || "";
      } catch (err: unknown) {
        return NextResponse.json(
          { error: `Could not read PDF text (scanned/image PDFs are not supported — export a text PDF or HTML). ${err instanceof Error ? err.message : ""}` },
          { status: 400 }
        );
      }
    } else if (name.endsWith(".html") || name.endsWith(".htm")) {
      text = htmlToText(buffer.toString("utf-8"));
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json({ error: "Unsupported file type. Upload a PDF, HTML, TXT, or MD file." }, { status: 400 });
    }

    text = text.trim();
    if (!text) return NextResponse.json({ error: "No readable text found in the file." }, { status: 400 });
    // A big HTML file yielding almost no text means the content lives in
    // scripts or images — parsing would "succeed" with nearly nothing in it.
    if ((name.endsWith(".html") || name.endsWith(".htm")) && buffer.length > 20000 && text.length < 1200) {
      return NextResponse.json({
        error: `This HTML file is ${(buffer.length / 1024).toFixed(0)}KB but contains almost no readable text (${text.length} characters) — the plan is likely rendered by scripts or stored as images. Open it in a browser and save as PDF (text, not scanned), or export the plan as plain HTML/TXT, then import again.`,
      }, { status: 400 });
    }
    const { parts: chunks, complete: readWholeFile } = splitForModel(text);
    const coveredChars = chunks.reduce((n, c) => n + c.length, 0);

    // Client context helps the model fill gaps and normalize dates/budget.
    const { data: client } = await supabase.from("clients").select("name, target_audience, products, deliverables_per_month, ad_budget").eq("id", clientId).single();
    const monthLabel = new Date(month).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    const system =
      "You are a planning parser for TBW Advertising. You convert a manually-written monthly marketing plan into a SINGLE structured JSON object, preserving the author's own words. You are a transcriber, not a copywriter — never rewrite, shorten or improve what the author wrote. Output ONLY the JSON — no markdown fences, no commentary.";

    // The art direction, caption and slide copy are the whole reason a plan is
    // worth importing. Asking for them verbatim is what stops the downstream
    // designer from inventing its own concept.
    const shape = `{ "date": "YYYY-MM-DD", "platform": "instagram|facebook|youtube", "format": "static|reel|carousel", "concept": "...", "hook": "...", "CTA": "...", "time": "...", "caption": "...", "slideCopy": ["..."], "productionNote": "...", "hashtags": "...", "complianceNote": "..." }`;

    const rowRules = `Rules for every calendar row:
- Preserve the author's real concepts, hooks, CTAs, dates and budget figures. Do NOT invent content that isn't implied.
- "hook" is the single big line the author wrote for that day, copied word for word.
- "caption" is the full caption to publish, copied VERBATIM including line breaks. Never summarise it.
- "productionNote" is the author's art/production direction for that day, copied VERBATIM (often written as "Production: ..."). This is a binding brief for whoever makes the asset — if it says "no logo, no product", that must survive. Empty string if the author gave none.
- "slideCopy" is the per-slide copy for a carousel, one array entry per slide, in order. Empty array if not a carousel.
- "hashtags" is the hashtag line exactly as written. "time" is the posting time as written ("7:30 PM").
- "complianceNote" is any legal, compliance or "read before publishing" warning attached to that day. Empty string if none.
- Normalize every date to "YYYY-MM-DD" within ${monthLabel}. If an item has no explicit date, spread it sensibly across the month.
- Map format to one of: "static", "reel", "carousel" — treat any video, film or reel as "reel". If a row offers BOTH a static and a video option (e.g. "Static / 10-sec Reel"), choose "static": a static deliverable exists for it, and statics are producible immediately. Map platform to "instagram", "facebook", or "youtube".

Also return "openQuestions": everything the author says is still missing, unconfirmed, awaited or blocking — the things they wrote down for themselves to chase. Copy each as a short phrase in their own words. Empty array if there are none. Never invent one.`;

    const fallback: FullPlan = { strategySummary: "", contentPillars: [], contentCalendar: [], budgetSummary: { allocations: [] }, openQuestions: [] };
    const merged: FullPlan = { strategySummary: "", contentPillars: [], contentCalendar: [], budgetSummary: { allocations: [] }, openQuestions: [] };

    // Each chunk is parsed on its own and the calendars are concatenated. Only
    // the first pass is asked for strategy and budget — those are stated once,
    // near the top, and asking every chunk invites invention.
    for (let i = 0; i < chunks.length; i++) {
      const first = i === 0;
      const userPrompt = `The following is ${chunks.length > 1 ? `part ${i + 1} of ${chunks.length} of ` : ""}a manually-written monthly marketing plan for client "${client?.name || ""}" targeting ${monthLabel}. Extract it faithfully into JSON.

${rowRules}
${first ? `- Client target budget for reference: INR ${Number(client?.ad_budget) || 0}. Deliverables target: ${Number(client?.deliverables_per_month) || 0}.\n- If budget figures are present, use them; otherwise leave allocations empty.` : "- This part continues the same plan. Return ONLY the calendar rows found in THIS part; leave strategySummary, contentPillars and budgetSummary empty."}

Return JSON with EXACTLY this shape:
{
  "strategySummary": "string",
  "contentPillars": ["..."],
  "contentCalendar": [ ${shape} ],
  "budgetSummary": { "allocations": [ { "objective": "...", "percentage": 0, "amount": 0, "rationale": "..." } ] },
  "openQuestions": ["..."]
}

PLAN CONTENT:
"""
${chunks[i]}
"""

Return ONLY valid JSON.`;

      const raw = await complete({
        purpose: "plan-import",
        system,
        messages: [{ role: "user", content: userPrompt }],
        model: MODEL_CHATGPT,
        jsonSchema: { type: "object" },
        // Captions and production notes carried verbatim are far larger than
        // the old six-field rows; 3000 truncated the JSON mid-array.
        maxTokens: 16000,
      });

      const part = parseWithRepair(raw, fallback);
      if (first) {
        merged.strategySummary = String(part.strategySummary || "");
        merged.contentPillars = Array.isArray(part.contentPillars) ? part.contentPillars.slice(0, 6) : [];
        merged.budgetSummary =
          part.budgetSummary && Array.isArray(part.budgetSummary.allocations) ? part.budgetSummary : { allocations: [] };
      }
      // A row without a date is still a row — dropping it silently is how a
      // "Day 1 / Day 2" plan shrinks to nothing. Keep anything with content;
      // missing dates are spread across the month after the merge.
      if (Array.isArray(part.contentCalendar)) {
        merged.contentCalendar.push(...part.contentCalendar
          .filter((s) => s && ((s.concept || "").trim() || (s.hook || "").trim() || (s.caption || "").trim()))
          .map((s) => ({ ...s, format: normalizeFormat(s.format) })));
      }
      if (Array.isArray(part.openQuestions)) merged.openQuestions.push(...part.openQuestions.map(String).filter(Boolean));
    }
    merged.openQuestions = Array.from(new Set(merged.openQuestions)).slice(0, 12);

    // Undated survivors get dates spread across the plan month, in order.
    const monthPrefix = `${new Date(month).getFullYear()}-${String(new Date(month).getMonth() + 1).padStart(2, "0")}`;
    const daysInMonth = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0).getDate();
    const undated = merged.contentCalendar.filter((s) => !String(s.date || "").trim());
    undated.forEach((s, i) => {
      const day = Math.min(daysInMonth, Math.max(1, Math.round(((i + 1) * daysInMonth) / (undated.length + 1))));
      s.date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    });

    // A day split across two chunks can come back twice — keep the richer copy.
    const byDate = new Map<string, CalendarSlot>();
    for (const slot of merged.contentCalendar) {
      const key = `${slot.date}|${(slot.concept || "").slice(0, 40)}`;
      const seen = byDate.get(key);
      const weight = (s: CalendarSlot) => (s.caption || "").length + (s.productionNote || "").length;
      if (!seen || weight(slot) > weight(seen)) byDate.set(key, slot);
    }
    merged.contentCalendar = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

    // Honesty check: how many dated entries does the file itself show, and how
    // many rows did we actually extract? A big gap means structure was lost —
    // the one situation that must never look like success.
    const dateSignals = countDateSignals(text);
    const underExtracted = dateSignals >= 4 && merged.contentCalendar.length < Math.ceil(dateSignals * 0.6);

    const withDirection = merged.contentCalendar.filter((s) => (s.productionNote || "").trim()).length;

    // What the plan itself asks for, read straight off the rows. A "black
    // teaser week" written into the notes is a decision about the month, and
    // the founder should meet it here — not in a batch of finished creatives.
    const notes = merged.contentCalendar.map((s) => (s.productionNote || "").trim()).filter(Boolean);
    const sample = Array.from(new Set(notes)).slice(0, 5).map((n) => n.slice(0, 110));
    const darkCount = notes.filter((n) => DARK_DIRECTION.test(n)).length;
    const styleTone = STYLE_TONE[style] || "";
    const styleClash =
      style && darkCount > 0 && !DARK_DIRECTION.test(styleTone)
        ? `${darkCount} row(s) call for dark/black frames, but the chosen style is "${style}"${styleTone ? ` (${styleTone})` : ""}. The plan's notes win where explicit — expect those posts to come out dark unless the notes are edited.`
        : null;

    // What the creative pipeline will be missing when it builds these posts.
    // Colours in particular are silently substituted with "tasteful neutrals"
    // when absent, so the gap never surfaces — it just produces off-brand work.
    const { data: brain } = await supabase
      .from("brand_brain")
      .select("colors, fonts, brand_brief")
      .eq("client_id", clientId)
      .maybeSingle();
    const brandGaps = {
      colors: !Array.isArray(brain?.colors) || (brain!.colors as unknown[]).length === 0,
      fonts: !Array.isArray(brain?.fonts) || (brain!.fonts as unknown[]).length === 0,
      brandBrief: !String(brain?.brand_brief || "").trim(),
    };

    return NextResponse.json({
      success: true,
      plan: merged,
      extractedChars: text.length,
      coveredChars,
      // Say plainly when the file outran the reader instead of quietly cutting.
      truncated: !readWholeFile,
      truncatedChars: readWholeFile ? 0 : Math.max(0, text.length - coveredChars),
      chunks: chunks.length,
      rowsWithDirection: withDirection,
      artDirection: { directed: withDirection, sample, darkCount, styleClash },
      dateSignals,
      underExtracted,
      // Everything the wizard should ask about before this plan is produced.
      needs: {
        placeholders: findPlaceholders(merged.contentCalendar),
        openQuestions: merged.openQuestions,
        brandGaps,
      },
      fileName: file.name,
    });
  } catch (err: unknown) {
    console.error("plan import error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import plan" }, { status: 500 });
  }
}
