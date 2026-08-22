import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse, stripMarkdownFences } from "@/lib/llm";

/**
 * Reading a job sheet photographed or screenshotted by a client.
 *
 * These arrive as a spreadsheet screenshot — a branding size list, a print
 * order, a shoot checklist — and today someone retypes each line into the task
 * board. The vision model transcribes it instead; the QC pass is the point,
 * because the rows people forget to fill (a size with no unit, a line with no
 * quantity) are exactly what a printer discovers too late.
 */

export interface ScannedTask {
  title: string;
  /** As written: "8 ft x 2 ft", "A4", "" when the sheet gave none. */
  size: string;
  /** Blank when the sheet didn't say — never guessed. */
  qty: string;
  remark: string;
  /** print | packaging | design | video | other — the closest task type. */
  type: string;
  /** What is missing or ambiguous on this row, in plain words. */
  issues: string[];
}

export interface ScanResult {
  /** The client the sheet names, as written on it. Empty if it names none. */
  clientHint: string;
  /** What the sheet is, one line — "Branding sizes for a store opening". */
  summary: string;
  tasks: ScannedTask[];
}

const SYSTEM = `You transcribe job sheets for an Indian advertising agency that produces jewellery branding, print and packaging. You copy what the sheet says — you never invent a value, never fill a blank, never convert units. You answer ONLY with JSON.`;

const PROMPT = `This image is a job sheet — usually a table of items to produce. Transcribe every row into JSON.

Return ONLY this shape:
{
  "clientHint": "the client/brand named on the sheet, exactly as written; empty string if none",
  "summary": "one line describing what this sheet is",
  "tasks": [
    {
      "title": "the item name from the 'Particular' / item column, as written",
      "size": "dimensions as written, e.g. '8 feet x 2 feet' or 'A4'; empty string if the row gives none",
      "qty": "quantity as written, e.g. '2'; EMPTY STRING if the row leaves it blank",
      "remark": "any remark/notes for that row, as written; empty string if none",
      "type": "print | packaging | design | video | other — the closest fit for producing this item",
      "issues": ["what is missing or ambiguous on THIS row"]
    }
  ]
}

Rules:
- One entry per item row. Skip the header row and any total row.
- Include rows that are unnumbered or incomplete — those are the ones people miss.
- NEVER fill a blank. An empty quantity stays an empty string and gets an issue.
- Raise an issue for each of these when true for a row:
  · a dimension with no unit ("6 x 3" with no feet/inches/cm) — say the unit is missing
  · a missing quantity
  · a paper/standard size where a dimension was expected (e.g. "A4") — say it needs confirming
  · anything unreadable in the image
- "issues" is an empty array when the row is complete.
- Copy Indian spellings and the sheet's own wording. Do not tidy names.`;

export async function scanJobSheet(imageDataUrl: string): Promise<ScanResult> {
  const raw = await completeVision({
    purpose: "task-scan",
    system: SYSTEM,
    prompt: PROMPT,
    imageDataUrl,
    maxTokens: 2000,
  });

  const parsed = safeJsonParse<ScanResult>(stripMarkdownFences(raw), {
    clientHint: "",
    summary: "",
    tasks: [],
  });

  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .map((t) => ({
      title: String(t?.title || "").trim(),
      size: String(t?.size || "").trim(),
      qty: String(t?.qty ?? "").trim(),
      remark: String(t?.remark || "").trim(),
      type: ["print", "packaging", "design", "video", "other"].includes(String(t?.type)) ? String(t.type) : "print",
      issues: Array.isArray(t?.issues) ? t.issues.map(String).filter(Boolean) : [],
    }))
    .filter((t) => t.title);

  // A second, deterministic QC pass. The model is good at reading the sheet and
  // inconsistent at judging it, so the rules that matter are checked in code:
  // they must fire the same way every time, on every sheet.
  const UNITLESS = /^[\d\s.,x×*]+$/i;
  for (const t of tasks) {
    const add = (msg: string) => { if (!t.issues.some((i) => i.toLowerCase().includes(msg.slice(0, 14).toLowerCase()))) t.issues.push(msg); };
    if (t.size && UNITLESS.test(t.size)) add("No unit on the size — feet or inches?");
    if (!t.qty) add("No quantity given.");
    if (/^a\d$|^letter$|^legal$/i.test(t.size)) add(`Size reads "${t.size}" — confirm it is paper size, not a board dimension.`);
    if (!t.size) add("No size given.");
  }

  return {
    clientHint: String(parsed.clientHint || "").trim(),
    summary: String(parsed.summary || "").trim(),
    tasks,
  };
}

/** The one-line description stored on the task, built from what the sheet said. */
export function describeScanned(t: ScannedTask): string {
  return [
    t.size && `Size: ${t.size}`,
    t.qty && `Qty: ${t.qty}`,
    t.remark && `Note: ${t.remark}`,
  ].filter(Boolean).join(" · ");
}
