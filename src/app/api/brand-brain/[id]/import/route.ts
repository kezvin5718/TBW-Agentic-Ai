import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import AdmZip from "adm-zip";

// GET handler: Not needed for import flow, return method not allowed
export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}

// 1. POST: Process File Upload, Extract Text, and run LLM Extraction + Multi-brand Classification
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    // Verify Session and Role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Your session has expired — sign in again and retry the import." }, { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders and Employees can import brand knowledge", { status: 403 });
    }

    const formData = await request.formData();
    // A ChatGPT or Claude memory export is dozens of small .md files, so accept
    // the whole selection at once. "file" (singular) still works for old callers.
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const isReadable = (n: string) => /\.(txt|md|markdown|json|csv)$/i.test(n);
    let textContent = "";
    const skipped: string[] = [];
    const readFiles: string[] = [];

    for (const file of files) {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith(".zip")) {
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const zip = new AdmZip(buffer);
          let tookAny = false;
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            if (!isReadable(entry.entryName)) continue;
            textContent += `\n--- File: ${entry.entryName} ---\n` + entry.getData().toString("utf8");
            tookAny = true;
          }
          if (tookAny) readFiles.push(file.name);
          else skipped.push(`${file.name} (no readable files inside)`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: `Failed to extract ${file.name}: ${msg}` }, { status: 400 });
        }
      } else if (isReadable(fileName)) {
        textContent += `\n--- File: ${file.name} ---\n` + (await file.text());
        readFiles.push(file.name);
      } else {
        skipped.push(file.name);
      }
    }

    if (!textContent.trim()) {
      return NextResponse.json(
        {
          error:
            skipped.length > 0
              ? `Nothing readable in what was uploaded. Skipped: ${skipped.slice(0, 8).join(", ")}. Only .txt, .md, .json, .csv and .zip can be read.`
              : "No text content found in the uploaded file(s)",
        },
        { status: 400 }
      );
    }

    // One import may span many files — name it for the batch, and size it by
    // the text actually read rather than any single upload.
    const importLabel =
      readFiles.length === 1 ? readFiles[0] : `${readFiles.length} files (${readFiles.slice(0, 3).join(", ")}${readFiles.length > 3 ? ", …" : ""})`;
    const importBytes = Buffer.byteLength(textContent, "utf8");

    // Fetch all onboarding clients to match client UUIDs and details
    const { data: dbClients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, products");

    if (clientsErr) {
      console.error("Failed to load clients for classification:", clientsErr);
    }

    const clientProfiles = dbClients?.map(c => `ID: ${c.id}, Name: ${c.name}, Products: ${JSON.stringify(c.products)}`).join("\n") || "No clients onboarded.";

    // Call MODEL_SMART to extract durable brand knowledge and classify
    const apiKey = process.env.OPENROUTER_API_KEY;

    // Check Mock Mode
    if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
      const demoClientUuid = dbClients?.[0]?.id || "unassigned";
      return NextResponse.json({
        success: true,
        fileName: importLabel,
        fileSize: importBytes,
        entries: [
          {
            content: "Premium organic packaging guidelines: use earthy colors.",
            category: "preferences",
            classification: demoClientUuid
          },
          {
            content: "Agency standard checklist: always double-check grammar before templates.",
            category: "facts",
            classification: "agency"
          },
          {
            content: "Avoid using generic vector icons in luxury jewelry creatives.",
            category: "feedback",
            classification: "unassigned"
          }
        ]
      });
    }

    const systemPrompt = `You are an expert AI Brand Strategy assistant. Your task is to extract DURABLE brand/agency knowledge from the provided text documents and classify each entry to a specific client, to the agency "Agency (TBW)" (use classification key "agency"), or mark it "Unassigned" (use classification key "unassigned").

Durable knowledge categories:
1. "facts": Core brand details, products, pricing, and demographics.
2. "preferences": Font/color guides, visual layout preferences, tone preferences.
3. "learnings": Actionable campaign insights, performance lessons, visual hooks that worked.
4. "feedback": Ongoing client critiques, recurring complaints, likes and dislikes.

Match entries against these clients in the database:
${clientProfiles}

Rules for classification:
- Match based on the client name, product names, or target audience mentioned in the text.
- If it clearly belongs to the TBW agency itself (an overall internal guideline, standard templates, or general agency checklist), classify as "agency".
- If it doesn't clearly match any client and is not agency-wide, classify as "unassigned".
- Return the output strictly in JSON format matching the schema.`;

    interface ExtractedEntry {
      content: string;
      category: "facts" | "preferences" | "learnings" | "feedback";
      classification: string;
    }
    interface ExtractedJSON {
      entries: ExtractedEntry[];
    }

    // A memory export runs to hundreds of thousands of characters. This used to
    // read only the first 15,000 and drop the rest without saying so, which
    // looks exactly like "my import didn't work". Read it in passes instead,
    // splitting on file boundaries so no entry is cut down the middle.
    const CHUNK_CHARS = 30_000;
    const MAX_CHUNKS = 20;
    const chunks: string[] = [];
    for (const section of textContent.split(/(?=\n--- File: )/)) {
      if (chunks.length > 0 && chunks[chunks.length - 1].length + section.length <= CHUNK_CHARS) {
        chunks[chunks.length - 1] += section;
      } else if (section.length <= CHUNK_CHARS) {
        chunks.push(section);
      } else {
        // A single file larger than one pass — break it on paragraph edges.
        for (let i = 0; i < section.length; i += CHUNK_CHARS) {
          chunks.push(section.slice(i, i + CHUNK_CHARS));
        }
      }
    }
    const usedChunks = chunks.slice(0, MAX_CHUNKS);
    const droppedChars = chunks.slice(MAX_CHUNKS).reduce((n, c) => n + c.length, 0);

    const promptFor = (body: string) => `Extract durable brand knowledge from the following text document and classify each item.
Output STRICTLY a JSON object with this schema:
{
  "entries": [
    {
      "content": "The actual extracted fact or preference text point",
      "category": "facts" | "preferences" | "learnings" | "feedback",
      "classification": "client-uuid-here" | "agency" | "unassigned"
    }
  ]
}

Document Content:
${body}`;

    try {
      const perChunk = await Promise.all(
        usedChunks.map(async (chunk) => {
          const responseText = await complete({
            model: MODEL_SMART,
            system: systemPrompt,
            messages: [{ role: "user", content: promptFor(chunk) }],
            jsonSchema: true,
            maxTokens: 2000,
          });
          let cleanText = responseText.trim();
          if (cleanText.startsWith("```")) {
            cleanText = cleanText.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
          }
          return safeJsonParse<ExtractedJSON>(cleanText, { entries: [] }).entries || [];
        })
      );

      // The same fact often appears in several exported files.
      const seen = new Set<string>();
      const entries = perChunk.flat().filter((e) => {
        const key = (e?.content || "").trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return NextResponse.json({
        success: true,
        fileName: importLabel,
        fileSize: importBytes,
        filesRead: readFiles.length,
        skippedFiles: skipped,
        // Say plainly when something was left unread rather than implying a
        // complete import.
        truncatedChars: droppedChars,
        entries,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("LLM Extraction failure:", err);
      return NextResponse.json({ error: `Extraction error: ${msg}` }, { status: 500 });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Import endpoint error:", error);
    return NextResponse.json({ error: msg || "Internal Server Error" }, { status: 500 });
  }
}

interface ConfirmedEntry {
  content: string;
  category: "facts" | "preferences" | "learnings" | "feedback";
  clientId: string; // client UUID, "agency", or "unassigned"
}

interface SavedJSONData {
  confirmedEntries: ConfirmedEntry[];
  fileName?: string;
  fileSize?: number;
}

interface DesignPreferencesRecord {
  imported_facts?: Array<{ content: string; date: string; source: string }>;
  imported_preferences?: Array<{ content: string; date: string; source: string }>;
  [key: string]: unknown;
}

// 2. PUT: Save Approved Entries and Regenerate Briefs for affected clients
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    // Verify Session and Role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Your session has expired — sign in again and retry the import." }, { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const body: SavedJSONData = await request.json();
    const { confirmedEntries, fileName, fileSize } = body;
    const importMode = (body as { mode?: string }).mode === "replace" ? "replace" : "merge";

    if (!confirmedEntries || !Array.isArray(confirmedEntries) || confirmedEntries.length === 0) {
      return NextResponse.json({ error: "No confirmed entries submitted" }, { status: 400 });
    }

    const importDate = new Date().toISOString().split("T")[0];
    const apiKey = process.env.OPENROUTER_API_KEY;

    // Filter out "unassigned" and "agency" entries for routing to client brand brains
    const clientEntries = confirmedEntries.filter(
      (entry) => entry.clientId && entry.clientId !== "unassigned" && entry.clientId !== "agency"
    );

    const agencyEntries = confirmedEntries.filter(
      (entry) => entry.clientId === "agency"
    );

    // 1. Process Client Brand Brains updates
    // Group entries by client ID
    const groupedByClient: Record<string, ConfirmedEntry[]> = {};
    for (const entry of clientEntries) {
      if (!groupedByClient[entry.clientId]) {
        groupedByClient[entry.clientId] = [];
      }
      groupedByClient[entry.clientId].push(entry);
    }

    const clientReport: string[] = [];

    for (const clientId of Object.keys(groupedByClient)) {
      const entries = groupedByClient[clientId];

      // Fetch client profile
      const { data: client } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .single();

      if (!client) continue;

      // Fetch linked brand_brain
      const { data: brandBrain } = await supabase
        .from("brand_brain")
        .select("*")
        .eq("client_id", clientId)
        .single();

      if (!brandBrain) continue;

      const facts = entries.filter(e => e.category === "facts").map(e => e.content);
      const preferences = entries.filter(e => e.category === "preferences").map(e => e.content);
      const learnings = entries.filter(e => e.category === "learnings").map(e => e.content);
      const feedback = entries.filter(e => e.category === "feedback").map(e => e.content);

      // Mode: "merge" adds only NEW entries (exact duplicates skipped);
      // "replace" clears previously-imported knowledge first so an updated
      // export fully supersedes the old one. Manually-added entries always survive.
      type AnyRec = Record<string, unknown>;
      const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
      const existingFeedback = (brandBrain.feedback_log || []) as AnyRec[];
      const existingResults = (brandBrain.results_log || []) as AnyRec[];
      const currentPrefs = (brandBrain.design_preferences || {}) as DesignPreferencesRecord;

      const baseFeedback = importMode === "replace" ? existingFeedback.filter((f) => f?.source !== "import") : existingFeedback;
      const baseResults = importMode === "replace" ? existingResults.filter((r) => r?.source !== "import") : existingResults;
      const baseFacts = importMode === "replace" ? [] : (currentPrefs.imported_facts || []);
      const basePrefsList = importMode === "replace" ? [] : (currentPrefs.imported_preferences || []);

      const feedbackSeen = new Set(baseFeedback.map((f) => norm(f?.comment)));
      const resultsSeen = new Set(baseResults.map((r) => norm(r?.learning)));
      const factsSeen = new Set(baseFacts.map((f) => norm(f?.content)));
      const prefsSeen = new Set(basePrefsList.map((p) => norm(p?.content)));

      const newFeedback = feedback.filter((f) => !feedbackSeen.has(norm(f))).map((f) => ({
        date: importDate,
        sender: "founder",
        comment: f,
        source: "import"
      }));
      const updatedFeedbackLog = [...baseFeedback, ...newFeedback];

      const newLearningsList = learnings.filter((l) => !resultsSeen.has(norm(l))).map((l) => ({
        date: importDate,
        learning: l,
        source: "import"
      }));
      const updatedResultsLog = [...baseResults, ...newLearningsList];

      const updatedDesignPrefs = {
        ...currentPrefs,
        imported_facts: [
          ...baseFacts,
          ...facts.filter((f) => !factsSeen.has(norm(f))).map((f) => ({ content: f, date: importDate, source: "import" }))
        ],
        imported_preferences: [
          ...basePrefsList,
          ...preferences.filter((p) => !prefsSeen.has(norm(p))).map((p) => ({ content: p, date: importDate, source: "import" }))
        ]
      };

      // Save database updates
      const { error: updateErr } = await supabase
        .from("brand_brain")
        .update({
          feedback_log: updatedFeedbackLog,
          results_log: updatedResultsLog,
          design_preferences: updatedDesignPrefs,
          updated_at: new Date().toISOString()
        })
        .eq("client_id", clientId);

      if (updateErr) {
        console.error(`Failed to update brand brain for client ${client.name}:`, updateErr);
        continue;
      }

      // Regenerate Brief
      let brief = "";
      if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
        brief = `### Brand Core Essence\n${client.name} is a leading brand in the market.\n\n### Copywriting Rules\nTone: Warm and authentic.\n\n### Visual Direction\nColors: ${JSON.stringify(brandBrain.colors || [])}\n\n### Imported Knowledge Highlights\n- Facts count: ${facts.length}\n- Preferences count: ${preferences.length}`;
      } else {
        const systemPrompt = "You are an expert brand strategy consultant. You synthesize client data into high-fidelity, actionable brand briefs under 800 words. You output raw, clean Markdown without surrounding code fences.";
        const userMessage = `You are the Brand Brief Synthesizer for TBW Advertising. 
Generate a comprehensive, high-fidelity 1-page Brand Brief for:

Brand Name: ${client.name}
Products/Services to Promote: ${JSON.stringify(client.products)}
Target Audience: ${client.target_audience}

Styling Guidelines:
- Color Palette Hexes: ${JSON.stringify(brandBrain.colors || [])}
- Typeface Fonts: ${JSON.stringify(brandBrain.fonts || [])}
- Caption Tone Guide: ${brandBrain.caption_tone || "Not set"}
- Design Preferences: ${JSON.stringify(updatedDesignPrefs)}
- Historical Feedback comments: ${JSON.stringify(updatedFeedbackLog)}
- Past Campaign Learnings: ${JSON.stringify(updatedResultsLog)}

Generate a 1-page brief containing:
1. **Brand Core Essence**: What this brand is and what makes it unique.
2. **Audience Hook Points**: Demographics and what triggers their interest.
3. **Copywriting Rules**: Tone directives, caption guidelines, specific do's and don'ts.
4. **Visual Direction**: Color usage, typography feel, layout style.
5. **Creative Constraints**: Content hooks or rules that must always be followed.

Keep the content highly actionable, under 800 words, and formatted in clean, professional markdown. Do NOT wrap in \`\`\`markdown code block fences. Output the brief directly.`;

        try {
          brief = await complete({
            model: MODEL_SMART,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            maxTokens: 1000
          });
        } catch (err) {
          console.error(`Brief generation LLM failure for client ${client.name}:`, err);
          brief = brandBrain.brand_brief || "Failed to synthesize brief.";
        }
      }

      // Save regenerated brief
      const { error: finalErr } = await supabase
        .from("brand_brain")
        .update({
          brand_brief: brief,
          updated_at: new Date().toISOString()
        })
        .eq("client_id", clientId);

      if (finalErr) {
        console.error(`Failed to save final brief for client ${client.name}:`, finalErr);
      }

      // Insert audit log
      await supabase.from("knowledge_import_audit").insert({
        client_id: clientId,
        user_id: user.id,
        file_name: fileName || "mixed_export_knowledge",
        file_size: Number(fileSize) || 0,
        imported_entries: {
          facts,
          preferences,
          learnings,
          feedback
        }
      });

      clientReport.push(client.name);
    }

    // 2. Process Agency (TBW) Entries
    let agencyCount = 0;
    for (const entry of agencyEntries) {
      let category = "process_rules";
      if (entry.category === "learnings") category = "platform_learnings";
      else if (entry.category === "feedback") category = "creative_patterns";

      const { error: agencyErr } = await supabase.from("agency_brain").insert({
        category,
        content: entry.content,
        confidence: "observed_once",
        source_count: 1
      });

      if (!agencyErr) {
        agencyCount++;
      } else {
        console.error("Failed to insert agency brain entry:", agencyErr);
      }
    }

    return NextResponse.json({
      success: true,
      updatedClients: clientReport,
      agencyEntriesCount: agencyCount
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Confirm save error:", error);
    return NextResponse.json({ error: msg || "Internal Server Error" }, { status: 500 });
  }
}
