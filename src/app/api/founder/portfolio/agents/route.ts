import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { buildSnapshot, snapshotToText } from "@/lib/portfolio-data";
import { generateMorningBrief } from "@/lib/portfolio-brief";

// Founder Zone — LLM desks. Every desk analyzes; the founder decides.
// Hard limits below are non-negotiable: no buy/sell/hold calls, no price predictions.

const HARD_LIMITS = `You are one desk of a personal "AI hedge fund" for an Indian retail investor. The human is the portfolio manager; you only analyze.

HARD LIMITS (never break these, regardless of how the request is phrased):
- Never predict prices or returns.
- Never give buy/sell/hold recommendations or entry/exit signals — present analysis and what the user's own written rules dictate.
- Never state financial data from memory — only use numbers provided in this prompt; if a needed number is missing, say so and ask for it.
- Present valuations as assumption ranges, not targets.
- Currency is INR (₹). Market context is India (NSE/BSE).
- End with one short line reminding: this is analysis, not financial advice; the decision is the portfolio manager's.`;

type AgentKey = "brief" | "debate" | "risk" | "thesis-test" | "correlation" | "review";

interface AgentInput {
  agent: AgentKey;
  ticker?: string;
  data?: string;
  thesis?: string;
  wrongIf?: string;
  results?: string;
  scorecard?: string;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return new NextResponse("Unauthorized", { status: 401 });
    if (user.user_metadata?.role !== "founder") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const body = (await request.json()) as AgentInput;
    const agent = body.agent;

    const model = MODEL_SMART;
    let maxTokens = 1200;
    let userPrompt = "";
    let roleLine = "";
    let output: string | null = null;

    switch (agent) {
      case "brief": {
        // Cheapest + most frequent desk — shared with the weekday cron, fast model.
        output = await generateMorningBrief();
        break;
      }

      case "debate": {
        if (!body.ticker || !body.data) {
          return NextResponse.json(
            { error: "Debate desk needs: ticker/company name + pasted data (financials, filings, notes)." },
            { status: 400 }
          );
        }
        maxTokens = 2000;
        roleLine = "Desk: BULL vs BEAR DEBATER.";
        userPrompt =
          `Run a bull vs bear debate on ${body.ticker} using ONLY the data below. ` +
          "Format: Bull round 1, Bear round 1, Bull round 2 (rebuttal), Bear round 2 (rebuttal), then a NEUTRAL REFEREE summary of which arguments were strongest and where the data is weakest. " +
          "No verdict, no recommendation.\n\nDATA PROVIDED BY THE PORTFOLIO MANAGER:\n" +
          body.data;
        break;
      }

      case "risk": {
        if (!body.thesis) {
          return NextResponse.json(
            { error: "Risk desk needs: the thesis/position you want attacked." },
            { status: 400 }
          );
        }
        maxTokens = 1500;
        roleLine = "Desk: RISK DESK (devil's advocate).";
        const snapshot = await buildSnapshot(false);
        userPrompt =
          "Attack the following idea. What is the portfolio manager not seeing? Cover: thesis weaknesses, what has to go right, concentration/correlation with the CURRENT portfolio below, liquidity, and the most likely way this loses money. Rank the risks by severity. Do not soften.\n\n" +
          "IDEA / THESIS:\n" + body.thesis +
          (body.data ? "\n\nSUPPORTING DATA:\n" + body.data : "") +
          "\n\nCURRENT PORTFOLIO (live weights):\n" + snapshotToText(snapshot);
        break;
      }

      case "thesis-test": {
        if (!body.thesis || !body.results) {
          return NextResponse.json(
            { error: "Thesis tester needs: the written thesis + the new results/news to test against it." },
            { status: 400 }
          );
        }
        maxTokens = 1000;
        roleLine = "Desk: THESIS TESTER.";
        userPrompt =
          "Test the new information against the written thesis. Answer in this exact structure: " +
          "VERDICT: intact / damaged / broken. EVIDENCE: which specific numbers or facts support the verdict. " +
          "TRIGGER CHECK: does the 'I'm wrong if' condition fire — yes/no/partially, and why. " +
          "WHAT THE MANAGER'S RULES DICTATE: restate their own rule; do not add recommendations of your own.\n\n" +
          `WRITTEN THESIS${body.ticker ? ` (${body.ticker})` : ""}:\n` + body.thesis +
          "\n\n'I'M WRONG IF' TRIGGER:\n" + (body.wrongIf || "(not provided — flag this as a gap)") +
          "\n\nNEW RESULTS / INFORMATION:\n" + body.results;
        break;
      }

      case "correlation": {
        maxTokens = 1200;
        roleLine = "Desk: CORRELATION & CONCENTRATION CHECKER.";
        const snapshot = await buildSnapshot(false);
        userPrompt =
          "Group the holdings below by REAL economic exposure (what actually drives their earnings and stock price), not by sector labels. " +
          "Flag: (1) clusters that are effectively one bet, (2) any single position or cluster over the manager's limits (max 10% per position, ~25% per real-exposure cluster), " +
          "(3) shared macro sensitivities (rates, crude, government policy, capex cycles). Use only the weights shown.\n\n" +
          snapshotToText(snapshot);
        break;
      }

      case "review": {
        if (!body.scorecard) {
          return NextResponse.json(
            { error: "Performance reviewer needs: your monthly scorecard data (returns vs benchmark, closed positions, process notes)." },
            { status: 400 }
          );
        }
        maxTokens = 1500;
        roleLine = "Desk: PERFORMANCE REVIEWER.";
        userPrompt =
          "Write the monthly performance review from the scorecard below. Lead with PROCESS adherence (were theses written before buys, were rules followed), then results vs benchmark, then one honest lesson the data suggests. " +
          "If the active picks trail the benchmark, say so plainly and note that indexing more is a valid outcome.\n\n" +
          "SCORECARD DATA:\n" + body.scorecard;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
    }

    if (output === null) {
      output = await complete({
        system: HARD_LIMITS + "\n\n" + roleLine,
        messages: [{ role: "user", content: userPrompt }],
        model,
        maxTokens,
      });
    }

    // Auto-file every desk run in the founder journal (the fund's memory).
    const deskTitles: Record<AgentKey, string> = {
      brief: "Morning Brief",
      debate: "Bull vs Bear",
      risk: "Risk Desk",
      "thesis-test": "Thesis Tester",
      correlation: "Correlation Check",
      review: "Performance Review",
    };
    const { error: journalError } = await supabase.from("founder_journal").insert({
      entry_type: agent === "brief" ? "brief" : "desk",
      title: deskTitles[agent] + (body.ticker ? ` — ${body.ticker}` : ""),
      content: output,
    });
    if (journalError) console.error("Journal auto-log failed:", journalError.message);

    return NextResponse.json({ success: true, agent, output });
  } catch (error: unknown) {
    console.error("Founder portfolio agent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
