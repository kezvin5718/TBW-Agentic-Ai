import { createClient } from "@/lib/supabase/server";

export async function getAgencyBrainDigest(): Promise<string> {
  try {
    const supabase = await createClient();

    const { data: entries, error } = await supabase
      .from("agency_brain")
      .select("category, content, confidence")
      .order("source_count", { ascending: false });

    if (error || !entries || entries.length === 0) {
      return "=== AGENCY BRAIN SHARED INSIGHTS ===\nNo shared learnings populated yet.";
    }

    const categories = [
      "creative_patterns",
      "performance_benchmarks",
      "platform_learnings",
      "prompt_patterns",
      "process_rules"
    ];

    const grouped: Record<string, string[]> = {
      creative_patterns: [],
      performance_benchmarks: [],
      platform_learnings: [],
      prompt_patterns: [],
      process_rules: []
    };

    entries.forEach((e) => {
      if (grouped[e.category] !== undefined && grouped[e.category].length < 4) {
        grouped[e.category].push(`- [${e.confidence}] ${e.content}`);
      }
    });

    let digest = "=== AGENCY BRAIN SHARED INSIGHTS ===\n";
    for (const cat of categories) {
      if (grouped[cat].length > 0) {
        const heading = cat.replace("_", " ").toUpperCase();
        digest += `\n${heading}:\n${grouped[cat].join("\n")}\n`;
      }
    }

    // Truncate to keep context under ~400 words (roughly 2000 characters)
    if (digest.length > 2000) {
      digest = digest.substring(0, 1950) + "\n... (truncated)";
    }

    return digest;
  } catch (err) {
    console.error("Error generating agency brain digest:", err);
    return "=== AGENCY BRAIN SHARED INSIGHTS ===\nUnable to load shared learnings.";
  }
}
