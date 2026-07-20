import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import AdmZip from "adm-zip";

// 1. POST: Process File Upload, Extract Text, and run LLM Extraction
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const supabase = await createClient();

    // Verify Session and Role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders and Employees can import brand knowledge", { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let textContent = "";

    // Parse ZIP file
    if (fileName.endsWith(".zip")) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory) continue;
          const entryName = entry.entryName.toLowerCase();
          if (
            entryName.endsWith(".txt") ||
            entryName.endsWith(".md") ||
            entryName.endsWith(".json")
          ) {
            textContent += `\n--- File: ${entry.entryName} ---\n` + entry.getData().toString("utf8");
          }
        }
      } catch (err: any) {
        return NextResponse.json({ error: `Failed to extract zip archive: ${err.message}` }, { status: 400 });
      }
    } else if (
      fileName.endsWith(".txt") ||
      fileName.endsWith(".md") ||
      fileName.endsWith(".json")
    ) {
      textContent = await file.text();
    } else {
      return NextResponse.json({ error: "Unsupported file type. Only .txt, .md, .json, and .zip are supported." }, { status: 400 });
    }

    if (!textContent.trim()) {
      return NextResponse.json({ error: "No text content found in the uploaded file(s)" }, { status: 400 });
    }

    // Call MODEL_SMART to extract durable brand knowledge
    const apiKey = process.env.OPENROUTER_API_KEY;

    // Check Mock Mode
    if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
      return NextResponse.json({
        success: true,
        fileName: file.name,
        fileSize: file.size,
        extracted: {
          facts: [
            `Durable brand fact: ${file.name} outlines SWAD premium organic packaging goals.`,
            "SWAD pricing tier is premium, with average margins target of 35% on spice packs.",
            "Primary target demographic is NRIs globally seeking authentic traditional taste."
          ],
          preferences: [
            "Tone should be warm, nostalgic, and rich in culinary pride.",
            "Visual preference: High-contrast close-ups of food textures, avoid bright backgrounds."
          ],
          learnings: [
            "Product close-up video hooks in the first 2.5 seconds increase CTR by 40%.",
            "Nostalgia-based copywriting focusing on 'ghar ka khana' memories converts best."
          ],
          feedback: [
            "Client dislikes plain stock photography; prefers authentic Indian tableware.",
            "Avoid neon colors or modern abstract art styles."
          ]
        }
      });
    }

    const systemPrompt = `You are an expert AI Brand Strategy assistant. Your task is to extract DURABLE brand knowledge from the provided text documents.
Durable knowledge includes: brand facts, products, pricing, target audience demographics, styling guidelines (colors/fonts), visual design preferences, campaign learnings (what works/what fails), and client feedback history.
You must DISCARD chit-chat, one-off task lists, dates, and anything not relating to the permanent identity/learning of the brand.
Return the output strictly in JSON format as a grouped checklist.`;

    const userPrompt = `Extract durable brand knowledge from the following text document. Group the extracted items into four categories:
1. "facts": Core brand identity details, products, pricing, and demographics.
2. "preferences": Font/color guides, visual layout preferences, tone preferences.
3. "learnings": Actionable campaign insights, performance lessons, visual hooks that worked.
4. "feedback": Ongoing client critiques, recurring complaints, likes and dislikes.

Provide 2-5 concise points per category. Output STRICTLY a JSON object matching this schema:
{
  "facts": ["Fact point 1", "Fact point 2"],
  "preferences": ["Pref point 1", "Pref point 2"],
  "learnings": ["Learning point 1", "Learning point 2"],
  "feedback": ["Feedback point 1", "Feedback point 2"]
}

Document Content:
${textContent.substring(0, 12000)}`;

    try {
      const responseText = await complete({
        model: MODEL_SMART,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        jsonSchema: true,
        maxTokens: 1000
      });

      let cleanText = responseText.trim();
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```[a-zA-Z]*\s*/, "");
        cleanText = cleanText.replace(/\s*```$/, "");
      }

      const extracted = JSON.parse(cleanText);
      return NextResponse.json({
        success: true,
        fileName: file.name,
        fileSize: file.size,
        extracted: {
          facts: extracted.facts || [],
          preferences: extracted.preferences || [],
          learnings: extracted.learnings || [],
          feedback: extracted.feedback || []
        }
      });
    } catch (err: any) {
      console.error("LLM Extraction failure:", err);
      return NextResponse.json({ error: `Extraction error: ${err.message}` }, { status: 500 });
    }
  } catch (error: any) {
    console.error("Import endpoint error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

// 2. PUT: Save Approved Entries and Regenerate Brief
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const supabase = await createClient();

    // Verify Session and Role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const { facts, preferences, learnings, feedback, fileName, fileSize } = await request.json();

    // 1. Fetch client details
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch linked brand_brain
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", clientId)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain profile not found" }, { status: 404 });
    }

    const importDate = new Date().toISOString().split("T")[0];

    // 3. Prepare Updates
    // A. Feedback logs
    const newFeedback = (feedback || []).map((f: string) => ({
      date: importDate,
      sender: "founder",
      comment: f,
      source: "import"
    }));
    const updatedFeedbackLog = [...(brandBrain.feedback_log || []), ...newFeedback];

    // B. Results logs
    const newLearnings = (learnings || []).map((l: string) => ({
      date: importDate,
      learning: l,
      source: "import"
    }));
    const updatedResultsLog = [...(brandBrain.results_log || []), ...newLearnings];

    // C. Design Preferences
    const updatedDesignPrefs = {
      ...(brandBrain.design_preferences || {}),
      imported_facts: [
        ...(brandBrain.design_preferences?.imported_facts || []),
        ...((facts || []).map((f: string) => ({ content: f, date: importDate, source: "import" })))
      ],
      imported_preferences: [
        ...(brandBrain.design_preferences?.imported_preferences || []),
        ...((preferences || []).map((p: string) => ({ content: p, date: importDate, source: "import" })))
      ]
    };

    // 4. Perform database update first to compile the guidelines data
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
      return NextResponse.json({ error: `Save failed: ${updateErr.message}` }, { status: 500 });
    }

    // 5. Regenerate the Brand Brief using the newly consolidated inputs
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

    const apiKey = process.env.OPENROUTER_API_KEY;
    let brief = "";

    if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
      brief = `### Brand Core Essence\n${client.name} is a leading brand in the market.\n\n### Copywriting Rules\nTone: Warm and authentic.\n\n### Visual Direction\nColors: ${JSON.stringify(brandBrain.colors || [])}\n\n### Imported Knowledge Highlights\n- Facts count: ${(facts || []).length}\n- Preferences count: ${(preferences || []).length}`;
    } else {
      try {
        brief = await complete({
          model: MODEL_SMART,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 1000
        });
      } catch (err: any) {
        console.error("Brief generation LLM failure during import:", err);
        brief = brandBrain.brand_brief || "Failed to synthesize brief.";
      }
    }

    // 6. Save Regenerated Brief to Brand Brain
    const { data: finalBrain, error: finalErr } = await supabase
      .from("brand_brain")
      .update({
        brand_brief: brief,
        updated_at: new Date().toISOString()
      })
      .eq("client_id", clientId)
      .select()
      .single();

    if (finalErr) {
      console.error("Failed to save final brief:", finalErr);
    }

    // 7. Log the import in the knowledge_import_audit table
    const { error: auditErr } = await supabase
      .from("knowledge_import_audit")
      .insert({
        client_id: clientId,
        user_id: user.id,
        file_name: fileName || "unknown_document",
        file_size: Number(fileSize) || 0,
        imported_entries: {
          facts: facts || [],
          preferences: preferences || [],
          learnings: learnings || [],
          feedback: feedback || []
        }
      });

    if (auditErr) {
      console.error("Failed to insert knowledge import audit log:", auditErr);
    }

    return NextResponse.json({
      success: true,
      brandBrief: brief,
      brandBrain: finalBrain || brandBrain
    });
  } catch (error: any) {
    console.error("Confirm save error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
