import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_CHATGPT } from "@/lib/llm-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CalendarSlot {
  date: string;
  platform: string;
  format: string;
  concept: string;
  hook: string;
  CTA: string;
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

const MAX_CHARS = 20000;

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
    const truncated = text.slice(0, MAX_CHARS);

    // Client context helps the model fill gaps and normalize dates/budget.
    const { data: client } = await supabase.from("clients").select("name, target_audience, products, deliverables_per_month, ad_budget").eq("id", clientId).single();
    const monthLabel = new Date(month).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    const system =
      "You are a planning parser for TBW Advertising. You convert a manually-written monthly marketing plan into a SINGLE structured JSON object, preserving the author's actual concepts, dates and budget. Output ONLY the JSON — no markdown fences, no commentary.";

    const userPrompt = `The following is a manually-written monthly marketing plan for client "${client?.name || ""}" targeting ${monthLabel}. Extract it faithfully into JSON.

Rules:
- Preserve the author's real concepts, hooks, CTAs, dates and budget figures. Do NOT invent content that isn't implied.
- Normalize every date to "YYYY-MM-DD" within ${monthLabel}. If a plan item has no explicit date, spread it sensibly across the month.
- Map each item's format to one of: "static", "reel", "carousel". Map platform to "instagram", "facebook", or "youtube".
- If budget figures are present, use them; otherwise leave allocations empty.
- Client target budget for reference: INR ${Number(client?.ad_budget) || 0}. Deliverables target: ${Number(client?.deliverables_per_month) || 0}.

Return JSON with EXACTLY this shape:
{
  "strategySummary": "string",
  "contentPillars": ["..."],
  "contentCalendar": [ { "date": "YYYY-MM-DD", "platform": "instagram|facebook|youtube", "format": "static|reel|carousel", "concept": "...", "hook": "...", "CTA": "..." } ],
  "budgetSummary": { "allocations": [ { "objective": "...", "percentage": 0, "amount": 0, "rationale": "..." } ] }
}

PLAN CONTENT:
"""
${truncated}
"""

Return ONLY valid JSON.`;

    const raw = await complete({
      system,
      messages: [{ role: "user", content: userPrompt }],
      model: MODEL_CHATGPT,
      jsonSchema: { type: "object" },
      maxTokens: 3000,
    });

    const fallback: FullPlan = { strategySummary: "", contentPillars: [], contentCalendar: [], budgetSummary: { allocations: [] } };
    const plan = safeJsonParse<FullPlan>(raw, fallback);
    plan.contentPillars = Array.isArray(plan.contentPillars) ? plan.contentPillars.slice(0, 6) : [];
    plan.contentCalendar = Array.isArray(plan.contentCalendar)
      ? plan.contentCalendar.filter((s) => s && s.date).sort((a, b) => (a.date < b.date ? -1 : 1))
      : [];
    if (!plan.budgetSummary || !Array.isArray(plan.budgetSummary.allocations)) plan.budgetSummary = { allocations: [] };

    return NextResponse.json({ success: true, plan, extractedChars: text.length, fileName: file.name });
  } catch (err: unknown) {
    console.error("plan import error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import plan" }, { status: 500 });
  }
}
