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
}

/**
 * How much plan text goes to the model in one pass. Anything longer is split
 * rather than cut: the old flat 20k cap silently dropped the tail of a real
 * 24k-character plan — the last days, the production list and the whole paid
 * layer — with nothing in the UI to say so.
 */
const CHUNK_CHARS = 18000;
/** A ceiling so a pathological upload can't fan out into dozens of calls. */
const MAX_CHUNKS = 6;

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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
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
- Map format to one of: "static", "reel", "carousel" — treat any video, film or reel as "reel". Map platform to "instagram", "facebook", or "youtube".`;

    const fallback: FullPlan = { strategySummary: "", contentPillars: [], contentCalendar: [], budgetSummary: { allocations: [] } };
    const merged: FullPlan = { strategySummary: "", contentPillars: [], contentCalendar: [], budgetSummary: { allocations: [] } };

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
  "budgetSummary": { "allocations": [ { "objective": "...", "percentage": 0, "amount": 0, "rationale": "..." } ] }
}

PLAN CONTENT:
"""
${chunks[i]}
"""

Return ONLY valid JSON.`;

      const raw = await complete({
        system,
        messages: [{ role: "user", content: userPrompt }],
        model: MODEL_CHATGPT,
        jsonSchema: { type: "object" },
        // Captions and production notes carried verbatim are far larger than
        // the old six-field rows; 3000 truncated the JSON mid-array.
        maxTokens: 16000,
      });

      const part = safeJsonParse<FullPlan>(raw, fallback);
      if (first) {
        merged.strategySummary = String(part.strategySummary || "");
        merged.contentPillars = Array.isArray(part.contentPillars) ? part.contentPillars.slice(0, 6) : [];
        merged.budgetSummary =
          part.budgetSummary && Array.isArray(part.budgetSummary.allocations) ? part.budgetSummary : { allocations: [] };
      }
      if (Array.isArray(part.contentCalendar)) merged.contentCalendar.push(...part.contentCalendar.filter((s) => s && s.date));
    }

    // A day split across two chunks can come back twice — keep the richer copy.
    const byDate = new Map<string, CalendarSlot>();
    for (const slot of merged.contentCalendar) {
      const key = `${slot.date}|${(slot.concept || "").slice(0, 40)}`;
      const seen = byDate.get(key);
      const weight = (s: CalendarSlot) => (s.caption || "").length + (s.productionNote || "").length;
      if (!seen || weight(slot) > weight(seen)) byDate.set(key, slot);
    }
    merged.contentCalendar = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

    const withDirection = merged.contentCalendar.filter((s) => (s.productionNote || "").trim()).length;

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
      fileName: file.name,
    });
  } catch (err: unknown) {
    console.error("plan import error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import plan" }, { status: 500 });
  }
}
