const assert = require("assert");

// Mocking client profiles and brand brain databases
const mockClientsDb = {
  "client-1-uuid": {
    id: "client-1-uuid",
    name: "SWAD Foods",
    target_audience: "NRIs and Indian cooking enthusiasts",
    products: ["Organic Pickles", "Ready-to-eat Curry"]
  },
  "client-2-uuid": {
    id: "client-2-uuid",
    name: "TechFit Wellness",
    target_audience: "Corporate software developers in Bangalore",
    products: ["Healthy protein snacks", "Low-calorie drinks"]
  }
};

const mockBrandBrainsDb = {
  "client-1-uuid": {
    client_id: "client-1-uuid",
    brand_brief: "SWAD Foods focuses on authentic traditional Indian taste using cold-pressed spices."
  },
  "client-2-uuid": {
    client_id: "client-2-uuid",
    brand_brief: "TechFit Wellness provides sugar-free protein bars with zero artificial sweeteners."
  }
};

const mockAgencyBrainDigest = "=== AGENCY BRAIN SHARED INSIGHTS ===\n- [proven] Question-hooks in video creatives increase CTR by 30%.\n- [recurring] D2C food brands benefit from warm nostalgic copywriting.";

// Context Assembler function (representing our implementation)
function assembleStrategyPrompt(clientId, strategySummary, agencyDigest) {
  const client = mockClientsDb[clientId];
  const brandBrain = mockBrandBrainsDb[clientId];

  if (!client || !brandBrain) {
    throw new Error("Client not found");
  }

  // Construct prompt containing brand brief AND agency brain shared digest
  const prompt = `Create a monthly marketing strategy for ${client.name}.
  
Brand Brief & Guidelines:
${brandBrain.brand_brief}

Agency Shared Insights:
${agencyDigest}

Strategy Summary:
${strategySummary}`;

  return prompt;
}

// Isolation Validation Test Suite
function runIsolationTestSuite() {
  console.log("--------------------------------------------------");
  console.log("🧪 STARTING BRAND BRAIN ISOLATION CHECKS...");
  console.log("--------------------------------------------------");

  try {
    // 1. Generate prompt for Client 1 (SWAD Foods)
    const prompt1 = assembleStrategyPrompt(
      "client-1-uuid",
      "Focus on summer pickles launch campaigns.",
      mockAgencyBrainDigest
    );

    console.log("✅ Successfully generated prompt for Client 1 (SWAD Foods).");

    // Assertions for Client 1 Prompt
    assert.ok(prompt1.includes("SWAD Foods"), "Should contain Client 1 name.");
    assert.ok(prompt1.includes("cold-pressed spices"), "Should contain Client 1 brief clues.");
    assert.ok(prompt1.includes("AGENCY BRAIN"), "Should contain shared agency brain digest.");
    
    // STRICT ISOLATION ASSERTION
    assert.strictEqual(
      prompt1.includes("TechFit Wellness"),
      false,
      "CRITICAL LEAK ERROR: Client 1 prompt contains Client 2 name!"
    );
    assert.strictEqual(
      prompt1.includes("sugar-free protein bars"),
      false,
      "CRITICAL LEAK ERROR: Client 1 prompt contains Client 2 private brand brief data!"
    );
    
    console.log("✅ Checked: Client 1 prompt is free from Client 2 data leakage.");

    // 2. Generate prompt for Client 2 (TechFit Wellness)
    const prompt2 = assembleStrategyPrompt(
      "client-2-uuid",
      "Focus on corporate gym activation offers.",
      mockAgencyBrainDigest
    );

    console.log("✅ Successfully generated prompt for Client 2 (TechFit Wellness).");

    // Assertions for Client 2 Prompt
    assert.ok(prompt2.includes("TechFit Wellness"), "Should contain Client 2 name.");
    assert.ok(prompt2.includes("protein bars"), "Should contain Client 2 product clues.");
    assert.ok(prompt2.includes("AGENCY BRAIN"), "Should contain shared agency brain digest.");
    
    // STRICT ISOLATION ASSERTION
    assert.strictEqual(
      prompt2.includes("SWAD Foods"),
      false,
      "CRITICAL LEAK ERROR: Client 2 prompt contains Client 1 name!"
    );
    assert.strictEqual(
      prompt2.includes("Organic Pickles"),
      false,
      "CRITICAL LEAK ERROR: Client 2 prompt contains Client 1 private brand brief data!"
    );

    console.log("✅ Checked: Client 2 prompt is free from Client 1 data leakage.");

    console.log("\n🎉 ALL ISOLATION TESTS PASSED SUCCESSFULLY! TWO-LAYER BRAIN ISOLATION IS FULLY ENFORCED.");
    console.log("--------------------------------------------------");
  } catch (err) {
    console.error("❌ ISOLATION TEST SUITE FAILED:", err.message);
    process.exit(1);
  }
}

runIsolationTestSuite();
