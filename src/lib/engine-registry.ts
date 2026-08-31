/**
 * Which AI engine runs which part of the portal.
 *
 * Two things already know this, and neither of them says it out loud: the
 * config (llm-config.ts and a couple of env vars) knows what is *configured*,
 * and llm_usage_logs knows what actually *ran*. This file is the third thing —
 * the human-readable map between them, so that "we want to move the art
 * director off Sonnet" is a decision the founder can make by reading one card
 * instead of asking a developer to grep.
 *
 * Every entry here was derived by opening the call site. The purpose tags are
 * the exact strings passed to complete()/completeVision()/logUsage(), because
 * Credit Logs joins on them — a typo here shows up as an area that mysteriously
 * has no traffic. The source file and line are noted on each entry so a
 * reviewer can check the claim in one jump.
 *
 * Keep this in step with the code. It is documentation with a job, and stale
 * documentation with a job is worse than none.
 */

/**
 * Where a model name comes from.
 *
 * The first three are constants in llm-config.ts — changing them is an edit and
 * a deploy. IMAGE_MODEL is deliberately an env var because image models get
 * retired faster than we ship. The last two are honest admissions: Whisper and
 * the quick image describer both have their model written into the code, and
 * pretending otherwise would defeat the point of this map.
 */
export type EngineConfigKey =
  | "MODEL_SMART"
  | "MODEL_FAST"
  | "MODEL_CHATGPT"
  | "IMAGE_MODEL env"
  | "OPENAI_API_KEY (Whisper)"
  | "hardcoded in openai-images.ts";

export interface EngineEntry {
  /** Founder-friendly name for the feature area. */
  area: string;
  /**
   * The exact purpose tags this area writes into llm_usage_logs. Empty means
   * the area is real but its calls are not metered through our ledger.
   */
  purposes: string[];
  /** Where this area's model name comes from. */
  config: EngineConfigKey;
  /**
   * A second engine the same purpose tag legitimately reaches — a caller-chosen
   * alternative, not drift. Without this the mismatch flag would cry wolf every
   * time someone used the option.
   */
  alsoConfig?: EngineConfigKey;
  /** One clause saying when the second engine is used. */
  alsoNote?: string;
  /** What a founder has to change, and whether it needs a deploy. */
  changeWhere: string;
  /** Where the call lives, for spot-checking this row against the code. */
  source: string;
  /** True when the area spends money somewhere this ledger cannot see. */
  unmetered?: boolean;
}

const LLM_CONFIG = "src/lib/llm-config.ts — needs deploy";
const ENV_RESTART = "server .env — restart only";

export const ENGINES: EngineEntry[] = [
  {
    area: "5b Art Director — designs posts & image prompts",
    purposes: ["post-design (5b)"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/post-designer.ts:261",
  },
  {
    area: "5b QC Critic — checks the render against its own brief",
    purposes: ["qc-critic (5b)"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/lib/post-studio.ts:498 (completeVision default)",
  },
  {
    area: "Content Hub QC — right brand, right festival",
    purposes: ["qc-checks"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/content-hub/qc/route.ts:107, src/lib/qc-utils.ts:117",
  },
  {
    area: "Captions — the social copywriter",
    purposes: ["captions"],
    config: "MODEL_CHATGPT",
    alsoConfig: "MODEL_FAST",
    alsoNote: "when the caller picks Gemini",
    changeWhere: LLM_CONFIG,
    source: "src/lib/caption-engine.ts:114",
  },
  {
    area: "Marketing plans — strategy, budget, calendar",
    purposes: ["planning"],
    config: "MODEL_SMART",
    alsoConfig: "MODEL_CHATGPT",
    alsoNote: "the one-shot full-plan generator",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/planning/generate-{strategy,budget,calendar}/route.ts; generate-full-plan/route.ts:100",
  },
  {
    area: "Plan importer — reads a plan file into the calendar",
    purposes: ["plan-import"],
    config: "MODEL_CHATGPT",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/planning/import/route.ts:336",
  },
  {
    area: "WhatsApp task bot — client chats into task drafts",
    purposes: ["whatsapp-tasks"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/wa-task-bot.ts:188",
  },
  {
    area: "WhatsApp webhook bot — replies and inbox extraction",
    purposes: ["whatsapp-bot"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/webhooks/whatsapp/route.ts:247,440; src/app/api/whatsapp-inbox/extract/route.ts:50",
  },
  {
    area: "Call notes — transcribing the recording",
    // Whisper is called directly at OpenAI, not through OpenRouter, and that
    // call is not written to llm_usage_logs. The row still belongs on the map:
    // it is a model the portal depends on, and its absence from the numbers is
    // itself worth knowing.
    purposes: [],
    config: "OPENAI_API_KEY (Whisper)",
    changeWhere: "src/lib/call-notes.ts — needs deploy",
    source: "src/lib/call-notes.ts:52 (whisper-1, billed by OpenAI directly)",
    unmetered: true,
  },
  {
    area: "Call notes — drafting tasks from the transcript",
    purposes: ["call-notes"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/call-notes.ts:196",
  },
  {
    area: "Image generation — backgrounds and text-heavy creatives",
    purposes: ["image-generation"],
    config: "IMAGE_MODEL env",
    changeWhere: ENV_RESTART,
    source: "src/lib/integrations/openai-images.ts:181 (imageModelName())",
  },
  {
    area: "Quick image descriptions — ad copy, style refs, plan posts",
    purposes: ["image-descriptions"],
    config: "hardcoded in openai-images.ts",
    changeWhere: "src/lib/integrations/openai-images.ts — needs deploy",
    source: "src/lib/integrations/openai-images.ts:52 (gpt-4o via OpenAI, else Gemini via OpenRouter)",
  },
  {
    area: "Creative reading — what a finished post actually shows",
    purposes: ["creative-reading"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/lib/creative-reader.ts:129 (completeVision default)",
  },
  {
    area: "Style extraction — turns reference designs into presets",
    purposes: ["style-extraction"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/lib/style-library.ts:106 (completeVision default)",
  },
  {
    area: "Bron — the founder's assistant",
    purposes: ["bron-assistant"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/jarvis.ts:77,181; src/lib/jarvis-tools.ts:214,245",
  },
  {
    area: "Ochrester — the manager brief",
    purposes: ["manager-brief"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/manager-brief.ts:610",
  },
  {
    area: "Task drafts — writes a brief for an open task",
    purposes: ["task-drafts"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/tasks/[id]/generate-draft/route.ts:127",
  },
  {
    area: "Reporting — the weekly client report",
    purposes: ["reporting"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/reporting/weekly-report/route.ts:130",
  },
  {
    area: "Brand Brain — brand briefs and document import",
    purposes: ["brand-brain"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/brand-brain/[id]/brief/route.ts:75; .../import/route.ts:200,436",
  },
  {
    area: "Daily briefing — the founder's morning WhatsApp",
    purposes: ["daily-briefing"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/cron-jobs.ts:77",
  },
  {
    area: "Automations — the scheduled agent runs",
    purposes: ["automation"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/lib/cron-jobs.ts:353,496",
  },
  {
    area: "Video prompts — the Higgsfield style block",
    purposes: ["video-prompts"],
    config: "MODEL_SMART",
    changeWhere: LLM_CONFIG,
    source: "src/app/api/production/higgsfield/generate/route.ts:70",
  },
  {
    area: "Product photo cleanup — finds the jewellery in the frame",
    purposes: ["photo-cleaning"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/lib/product-photo.ts:67 (completeVision default)",
  },
  {
    area: "Job sheet scan — reads a printed sheet into tasks",
    purposes: ["task-scan"],
    config: "MODEL_FAST",
    changeWhere: LLM_CONFIG,
    source: "src/lib/task-scan.ts:69 (completeVision default)",
  },
];
