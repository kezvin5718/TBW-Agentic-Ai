# PROJECT_KNOWLEDGE.md — TBW OS (`tbw-os`) Full System Reference

> Consolidated deep-read of the entire codebase as of 2026-08-01 (commit `ea4b854`).
> Companion to [AGENTS.md](AGENTS.md) (the aspirational spec) — **this doc describes what is actually built**, including simulated/stubbed surfaces and latent bugs. Keep it updated as the system changes.

---

## 1. What this is

AI-operations platform for **TBW Advertising**, an AI-video ad agency in India (prod domain `bron.digital`; in-app assistant branded **"Bron"**, sometimes labeled "Jarvis" in code). Human-in-the-loop: AI drafts strategy/creatives/captions/ad configs; **founders and clients approve** (dashboard + WhatsApp) before anything publishes or spends.

**Stack:** Next.js 15.5 (App Router, `output: "standalone"`) · React 19 · TS (strict) · Tailwind v4 · Supabase (Postgres + Auth + Storage) · LLM via **OpenRouter** · in-app `node-cron`. ~27.6k LOC, 54 commits (Jul 18–31 2026). Deploy: Docker Compose + Caddy on Ubuntu VPS.

**Models** (`src/lib/llm-config.ts`): `MODEL_SMART = anthropic/claude-sonnet-4.6`, `MODEL_FAST = google/gemini-2.5-flash` (both OpenRouter slugs).

### Maturity
Feature-complete, demo-ready — **not production-hardened**. Every dashboard page + API route is wired to real Supabase/LLM data. But: ad-performance metrics are entirely simulated, several "AI" outputs are hardcoded stubs, and every external integration **silently falls back to mock output when its API key is absent**. Locally only Supabase + OpenRouter keys are set → everything else runs degraded.

---

## 2. LLM layer (`src/lib/llm.ts`) — **read this before touching any prompt**

`complete({ system?, messages, jsonSchema?, model?, maxTokens? }) => Promise<string>` → OpenRouter `POST /api/v1/chat/completions`.

- **`jsonSchema` is NOT sent to the model.** A truthy value only sets `response_format: { type: "json_object" }`. All the schema objects declared in routes are documentation only. Output structure is enforced by prompt text + `safeJsonParse(text, default)` fallbacks. **To truly constrain output you must change `llm.ts`.**
- `maxTokens` default **2000** ("bypass credit reservation checks").
- Helpers: `stripMarkdownFences`, `safeJsonParse<T>(text, default)` (every JSON route supplies a hand-written default so the pipeline never hard-fails).
- **MOCK MODE** (key unset / `"mock"` / `mock_*`): returns canned strings branched on `system` keywords — `Classifier`→`{classification:"approval"}`, `QC`→passing QC report (SWAD Foods, misspelled `"Grammer & Spelling"`), `media`→mock campaign object, `brief`→canned brand brief, else `"SWAD Foods: Spicing up Bangalore's tech life!"`. These branches are what the app produces offline.

---

## 3. Data model (Supabase) — `supabase/schema.sql` ≡ `apply_all.sql` (byte-identical logic), + `supabase_migration.sql`

**25 tables total** (24 in schema + `scheduled_posts` from migration). `agency_settings` is the **only table without RLS**.

### Role model (two synced sources of truth)
- `profiles.role` ∈ `founder | employee | client` (+ `brand_name` links a client to `clients.name`).
- `auth.users.raw_user_meta_data` → JWT `user_metadata.role` (mirror).
- Kept in sync by triggers: `handle_new_user()` (on `auth.users` insert → creates profile) and `sync_profile_to_auth_users()` (on profile update → merges back to auth metadata).
- **RLS uses two mechanisms inconsistently**: older/core tables gate via **subquery on `profiles`**; newer tables gate via **JWT claim** `auth.jwt()->'user_metadata'->>'role'`. JWT-based policies see role changes only after token refresh.
- App-layer read: `user.user_metadata?.role || "client"`.

### Core entities (the 9 from spec)
| Table | Key columns / notes |
|---|---|
| `clients` | name, logo_url, guidelines_url, social_accounts(jsonb), products(jsonb), target_audience, deliverables_per_month, ad_budget, whatsapp_group_id |
| `brand_brain` | 1:1 with client (UNIQUE client_id). colors, fonts, caption_tone, design_preferences(jsonb), addresses, past_creatives, **feedback_log**, **results_log**, **brand_brief**(text) |
| `monthly_plans` | client_id, month(DATE), strategy_summary, content_pillars, content_calendar(jsonb), budget_summary, **media_plan**(jsonb), status ∈ `draft\|internal_review\|sent_to_client\|approved\|rejected` |
| `tasks` | plan_id, assignee_id(→profiles, SET NULL), type ∈ `copy\|image\|video\|ads`, deadline, priority, status ∈ `todo\|in_progress\|review\|done`, draft_content(jsonb), metadata(jsonb) |
| `creatives` | task_id, type, caption, media_url, qc_status ∈ `pending\|passed\|failed`, founder_approval, client_approval (both `pending\|approved\|rejected`), published_at, platform_post_id |
| `campaigns` | client_id, platform ∈ `meta\|google`, objective, budget_per_day, status(default PAUSED), external_campaign_id, control_mode ∈ `draft_only\|founder_approval_required\|auto_within_budget`, **optimisation_rules**(jsonb) |
| `metrics_daily` | campaign_id, date, spend, impressions, clicks, leads, results(jsonb: roas/ctr_percentage/cpc). UNIQUE(campaign_id, date) |
| `approvals` | client_id, entity_type(`plan\|creative\|campaign`), entity_id(polymorphic, no FK), approver_role(`founder\|client`), channel(`dashboard\|whatsapp`), decision(`approved\|rejected\|pending`), feedback_text. **ALL policy = `USING(true)` (open to any authed user)** |
| `leads` | company_name, contact_person, email, phone, status ∈ `new\|contacted\|interested\|visit_scheduled\|follow_up\|converted`, notes |

### Operational tables
`whatsapp_messages` (direction, classification ∈ approval/rejection/change_request/question/payment_related/angry/other, reply_draft) · `agency_settings` (KV, **no RLS**; keys: `default_assignees`, `festival_post_config`, `higgsfield_credentials`, `higgsfield_client_info`, `higgsfield_discovery_state`, `reference_cleanup_template`) · `client_credentials` (meta_page_token_encrypted, ig_business_id, meta_page_id; UNIQUE client_id) · `ad_ops_audit` (action_type, payload, response, actor_role) · `weekly_reports` (status `pending_founder_approval\|approved\|sent`) · `jarvis_pending_actions` (action_name, args, expires_at, status) · `jarvis_chat_history` · `gen_costs` (engine, prompt, cost, resolution) · `voice_audit` · `prompt_templates` (default_model `nano_banana\|gpt_image\|both`) · `generation_categories` (prompt_prefix/suffix, scaffold_json, engine, category_type) · `studio_generations` (generated_image_url, cost, is_branded, parent_generation_id, branded_variant_url, locally_unrecoverable) · `knowledge_import_audit` · `agency_brain` (category ∈ creative_patterns/performance_benchmarks/platform_learnings/prompt_patterns/process_rules, confidence ∈ observed_once/recurring/proven, source_count) · `scheduled_posts` (migration-only: media_url, platform `instagram\|facebook`, scheduled_for, status `scheduled\|published\|failed`, attempts, last_error).

### Supabase clients (`src/lib/supabase/`)
- `client.ts` → browser client (anon key).
- `server.ts` → `createClient()` (async, cookie-based, **respects RLS as the user**) + `createServiceRoleClient()` (**bypasses RLS**, throws if `SUPABASE_SERVICE_ROLE_KEY` unset).
- `middleware.ts` → `updateSession()` refreshes auth cookies.
- Storage buckets: **`brand-assets`** (public, logos/guidelines) and **`studio-outputs`** (Higgsfield results).

### Encryption (`src/lib/encryption.ts`)
AES-256-CBC, key = `scryptSync(ENCRYPTION_KEY, "salt", 32)` **or a hardcoded fallback hex key committed in source**. Format `ivHex:cipherHex`. Used for `client_credentials.meta_page_token_encrypted`. ⚠️ Set `ENCRYPTION_KEY` in prod.

---

## 4. Auth & routing (`src/middleware.ts`)

- `/` → `/dashboard` (auth) or `/login`. Unauth `/dashboard/*` → `/login?next=`. Auth on `/login` → `/dashboard`.
- **Founder-only**: `/dashboard/jarvis`, `/dashboard/onboarding`.
- **Client** restricted to: `/dashboard`, `/dashboard/reporting`, `/dashboard/brand-brain` only (everything else → `/dashboard`).
- Employee: full access except the two founder-only paths.
- `baseAppUrl` forces `https://bron.digital` if `NEXT_PUBLIC_APP_URL` looks like localhost/placeholder.

---

## 5. The pipeline, module by module

### 5.1 Onboarding (`api/onboarding`, `dashboard/onboarding`)
Founder/employee. 3-step wizard (overview / assets / products). Uploads logo+guidelines to `brand-assets`. Creates a `clients` row + an **empty** `brand_brain` scaffold. **No LLM at onboarding** (UI "AI synthesis" copy is aspirational — brief is generated later).

### 5.2 Brand Brain (`dashboard/brand-brain/[id]`, `api/brand-brain/[id]/*`)
- `brief` POST → LLM (MODEL_SMART) "Brand Brief Synthesizer" → 5-section markdown brief written to `brand_brain.brand_brief`. **This prompt is duplicated in `import` PUT — edit both.**
- `feedback` / `creatives` POST → prepend to `feedback_log` / `past_creatives`.
- **`import` (Knowledge Import)**: POST parses `.zip`(adm-zip)/`.txt`/`.md`/`.json` (15k-char cap), LLM classifies entries into 4 categories (`facts`/`preferences`/`learnings`/`feedback`) and routes to a client / `"agency"` / `"unassigned"`. PUT persists: client entries merge into brand_brain (+ brief regen), agency entries insert into `agency_brain`, `unassigned` **dropped**. Audit → `knowledge_import_audit`.

### 5.3 Planning (`api/planning/*`, `dashboard/planning`)
All generators are **stateless** (no DB write) except `save-plan`.
- `generate-strategy` → `{goals, focus, contentPillars}`; returns `strategySummary` with load-bearing `Goals:` / `Central Focus:` prefixes.
- `generate-calendar` → **Format Quantity Planner**: LLM returns slots, then code **deterministically pads/truncates to exact count and overwrites `format` fields** to hit exact static/reel/carousel quotas. Concepts/hooks from LLM; counts/formats guaranteed post-hoc.
- `generate-budget` → allocations summing to 100% / total budget.
- `save-plan` → manual upsert on `(client_id, month)`.
- `[id]/generate-media-plan` → Meta media plan JSON → `monthly_plans.media_plan`.
- `[id]/approve-media-plan`, `[id]/status`, `[id]/send-to-client` (WhatsApp).
- **Agency Brain digest** (`getAgencyBrainDigest()`) is injected into strategy/calendar/budget/media-plan, **not** into brand-brief.
- **Plan lifecycle**: `draft` → founder Approve sends `internal_review` (NOT `approved`) → `send-to-client` → `sent_to_client`. Client WhatsApp rejection → `rejected` + regen loop. `status="approved"` (reachable via API, not UI-wired here) triggers `generateTasksForPlan()`.

### 5.4 Tasks → Creatives (`lib/tasks-utils.ts`, `api/tasks/[id]/*`)
- `generateTasksForPlan(planId)` — one task per calendar slot; deadline = post date − 3 days; format→type map (reel/video→video, image/static/carousel→image, else copy); assignee from `agency_settings.default_assignees`.
- `generate-draft` → type-specific JSON (copy/image/video) via MODEL_FAST, injects agency digest + brand hex colors. → `tasks.draft_content`.
- **`generate-image` → MOCKED** (returns hardcoded Unsplash URLs; logs `gen_costs`).
- `upload-creative` → inserts `creatives` (pending), logs `creative_timeline`, runs `runCreativeQCCheck`.

### 5.5 QC (`lib/qc-utils.ts`)
`runCreativeQCCheck(creativeId)` — MODEL_FAST audit: grammar, brand-name spelling, claim verification (vs brief), offer/address accuracy. Writes `qc_status` + `qc_report`, logs `creative_timeline`, advances task to `review`(pass)/`in_progress`(fail). ⚠️ uses **user-scoped** `createClient()` (RLS-sensitive) unlike most jobs.

### 5.6 Creative review & publishing
- `creatives/[id]/founder-approve` → on approve, `requestWhatsAppApproval` to client; on reject, reopens task with founder_feedback.
- `dashboard/creatives-review` — founder swipe deck (video = simulated player), shows QC checks.
- `creatives/[id]/timeline` — reads **`creative_timeline`** table (event_type: creative_uploaded/qc_checked/founder_review/whatsapp_dispatched/client_review/posted/publish_failed).
- **`lib/publish-executor.ts`** — `executePublishForCreative` / `executePublishForScheduledPost`: fetch + decrypt per-client Meta token, publish to IG/FB with **3× retry**, update DB, log timeline, notify client group. Real Graph API (subject to meta.ts mock branch).
- `dashboard/publishing` — queue (approved+unpublished creatives) / scheduled posts / history / credentials settings. Scheduler runs every 15 min via cron.

### 5.7 Ads (`lib/ads-autopilot.ts`, `api/campaigns/*`, `dashboard/ads`)
- **`campaigns/deploy`** — 3 safety rails (require approved plan approval row; daily cap = ad_budget/30; require+decrypt creds). Pipeline: create PAUSED campaign → insert `campaigns` → PAUSED ad set (targeting hardcoded IN/18–65) → for each `qc_status='passed'` creative: upload media → create creative (⚠️ hardcoded `pageId "1234567890"`, thumbnail `example.com`) → create PAUSED ad. Everything audited to `ad_ops_audit`.
- **`runAdsAutopilot()` — METRICS FULLY SIMULATED** with `Math.random()`:
  - `spend = budget × (0.9–1.05)`, `impressions = spend × (15–25)`, `clicks = impressions × (0.5–2%)`, ROAS = 60% chance 1.6–2.8x else 0.6–1.3x, `leads = spend×roas / 200`.
  - Rule engine (from `optimisation_rules`): **PAUSE > TRIM > SCALE > HOLD**. PAUSE/TRIM need consecutive-day checks; SCALE uses only yesterday's ROAS. Scale cap = `min(rules.cap_budget, ad_budget/30)`.
  - Control-mode routing: `auto_within_budget` executes + audits + WhatsApp; `founder_approval_required` inserts pending `approvals` + WhatsApp link; `draft_only` no-op.
  - 4 alert types: overspend >1.15×, CTR<0.2%, zero delivery, **5%-random "disapproved ads"**.
- `campaigns/[id]/toggle-status` (draft_only can't activate), `optimisation-rules` (default: scale min_roas 2.0/+200/cap 5000; trim max_roas 1.8/target 800/2d; pause max_roas 1.2/3d).

### 5.8 Reporting & Learning
- `reporting/weekly-report` — aggregates metrics, LLM markdown report → `weekly_reports` (pending → founder approve → WhatsApp send).
- `dashboard/reporting` — analytics (**fabricates metrics client-side**), weekly reports, CRM kanban over `/api/leads`.
- **`runLearningLoop()`** (weekly) — Pass 1: per-client brand_brain re-tuning (caption_tone + design_preferences via LLM, with MOCK branch). Pass 2: **Agency Brain** consolidation — extracts anonymized patterns (strict no-client-names rule), dedupes against existing rows, upgrades confidence (source_count ≥5 proven / ≥2 recurring). ⚠️ closed-loop write-back per AGENTS.md Rule 4.

### 5.9 Bron / Jarvis (`lib/jarvis.ts`, `lib/jarvis-tools.ts`, `api/jarvis/chat`, `dashboard/jarvis`)
- `processJarvisCommand` — 2-turn loop (classify tool → execute → reformat), MODEL_SMART, founder-only.
- **13 tools**. Read tools (pending_approvals, client_status, campaign_metrics, overdue_tasks, lead_pipeline, search_brand_brain) = real. Draft tools: `draft_client_reply` real (LLM); **`generate_plan` & `draft_weekly_report` = hardcoded stub strings**.
- **Action pattern**: action tools (approve_creative, activate_campaign, update_budget, send_to_client) insert a `jarvis_pending_actions` row and return `PENDING_CONFIRMATION`. Execution via `execute_confirmed_action` gated on **typed "yes"** (voice-confirm blocked). ⚠️ `send_to_client` only writes a `whatsapp_messages` row — **does not call WhatsApp API**. `save_prompt_template` executor branch is **unreachable** (no matching classifier tool).
- Chat UI: Web Speech API STT (en-IN) fills the text box (user still submits → typed-confirm preserved); `speechSynthesis` TTS.

### 5.10 WhatsApp (`api/webhooks/whatsapp`, `lib/integrations/whatsapp.ts`, `lib/integrations/stt.ts`)
- Webhook: GET verifies `hub.verify_token`; POST ingests messages (real + simulator path), transcribes voice (Whisper), routes: founder sender → Bron; else classify (MODEL_FAST) → match client → update pending approval / draft question reply / escalate on `angry`.
- `whatsapp.ts` — Graph API **v20.0**, all sends **silently simulate** (`{simulated:true}`) if creds absent. `requestWhatsAppApproval` inserts pending `approvals` row.
- `stt.ts` — Whisper (mock transcript `"Show me overdue tasks"`) + TTS (`tts-1`, voice onyx, aac). Hinglish/Gujaralish prompt for brand terms.

---

## 6. Higgsfield / Image Studio (the strongest, most complete subsystem)

- **`lib/higgsfield-mcp.ts`** (~1505 LOC) — real MCP integration to `https://mcp.higgsfield.ai/mcp` via `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport`. Full OAuth2 (DCR + PKCE + refresh) via `DBOAuthClientProvider` persisting to `agency_settings` (`higgsfield_credentials`/`_client_info`/`_discovery_state`). PKCE verifier in httpOnly cookie. `HIGGSFIELD_ACCESS_TOKEN` env = static-token bypass. Functions: `getHiggsfieldCredentials` (auto-refresh 5-min buffer), `discoverHiggsfieldModels`, `executeHiggsfieldMCPTool` (401→refresh→retry), `getHiggsfieldGenerationCost` (**cost preflight** via `get_cost:true`), `pollHiggsfieldJobStatus` (executes server `recovery_tool`), `downloadAndStoreGeneratedMedia` (→ `studio-outputs` bucket, `public/uploads/` local fallback), `repairStudioGenerations` (ENOENT→`locally_unrecoverable`), `syncHiggsfieldGenerations`, `parseMCPToolResponse` (universal normalizer).
- **Machine-id map** (`higgsfield-config.ts`): "Nano Banana Pro"→`nano_banana_pro`(1.5cr), "Nano Banana 2"→`nano_banana_2`(1.0), "GPT Image 2"→`gpt_image_2`(2.0). ⚠️ AGENTS.md §7 states a **different** mapping (Nano Banana Pro→`nano_banana_2`) — the config file is the code truth; the two disagree.
- **`branding-composite.ts`** (Sharp) — overlays client logo (center-top) + address strip (bottom) server-side after download; branded variant saved as separate `studio_generations` row (`is_branded`, `cost:0`, `parent_generation_id`).
- **`higgsfield-state.ts`** — `activeJobs = new Map()` in-memory. ⚠️ **breaks on multi-instance/serverless** — generate→status handoff assumes same process.
- **Routes**: `production/higgsfield/{generate,status/[jobId],preflight-cost,history,sync,upload}` + `integrations/higgsfield/{connect,callback,disconnect,status,discover,manual,test,e2e-test}`. `generate` logs `gen_costs` **before** submit success (failed submit still bills). Monthly limit alert at 100 credits.
- **`image-studio/page.tsx`** (~2485 LOC) — Task Mode (from `?taskId`) vs Standalone. Style-reference (1 slot) + product images (1–10). Batch queue **concurrency 3**. Model/ratio/resolution (required) chips, category/template chips, festival post (locks 9:16), branding overlay, cost preview (preflight vs estimate), history gallery with **ENOENT "Local File Deleted"** overlay. `production/settings` = assignees/templates/categories CRUD (founder). `production/page.tsx` image tasks link out to Image Studio with query params.

---

## 7. Cron (`lib/cron-scheduler.ts`, `lib/cron-jobs.ts`, `src/instrumentation.ts`)

In-app `node-cron`, `Asia/Kolkata`, gated by `CRON_ENABLED=true` (started in `instrumentation.ts`). `vercel.json` is empty — no external cron declared; `/api/cron/*` routes are triggered by the scheduler or manually.

| Job | Schedule (IST) | Cron route | Auth |
|---|---|---|---|
| Publishing Scheduler | */15 min | `/api/cron/publish` | none |
| Ads Autopilot | 6 AM | `/api/cron/reporting` (misnamed) | Bearer `CRON_SECRET` in prod (GET); POST none |
| Bron Morning Briefing | 8 AM | `/api/cron/jarvis-briefing` | Bearer `CRON_SECRET` if set |
| Overdue Digest | 9 AM | `/api/cron/overdue-digest` | none |
| Weekly Learning Loop | Sun 23:59 | `/api/cron/learning` | Bearer `CRON_SECRET` if set (err 550) |

---

## 8. Simulated / stubbed / mock surfaces (know these before demos or edits)

1. **Ad metrics** — `ads-autopilot.ts` fabricates all `metrics_daily` via `Math.random()`. No real Meta Insights ingestion. (Rule engine/caps/audit are real, acting on fake data.)
2. **The `× 200` lead-value constant** (Rs/lead) drives ROAS/revenue in ≥6 places: `jarvis-tools.get_campaign_metrics`, `cron-jobs` briefing + autopilot, `weekly-report` route, `dashboard/page` founder ROAS, `dashboard/reporting` analytics. **No shared constant** — change all together.
3. **Hardcoded stub outputs**: `jarvis-tools.generate_plan` & `draft_weekly_report`; `tasks/[id]/generate-image` (Unsplash URLs); `execute_confirmed_action.send_to_client` (DB row, no API); `llm.ts` canned mock responses; learning-loop MOCK branch.
4. **All integrations mock-fallback** when key absent: Meta (`mock_*` IDs), WhatsApp (`{simulated:true}`), OpenAI STT/TTS/DALL-E, OpenRouter LLM, Gemini, Higgsfield (graceful defaults).
5. **`src/lib/modules/*` (all 8) are empty stubs** — `export const moduleName = '...'`. Dead scaffolding; real logic is in `src/lib/*.ts` + routes.
6. `reporting` analytics tab fabricates metrics client-side; `creatives-review` uses a simulated media player.

## 9. Hardcoded fallbacks / placeholders

Founder phone `9999999999` · client group `1234567890` · deploy ad account `1234567890` · creative `pageId 1234567890` · thumbnail `https://example.com/thumbnail.jpg` · encryption fallback key (in source) · STT mock transcript · ad-set targeting IN/18–65 (`billing_event=IMPRESSIONS`, `optimization_goal=REACH`) · Supabase placeholder URL/anon-key.

## 10. Known latent bugs (verify before relying on these paths)

- `jarvis-tools.get_client_status` published count is **not client-scoped** (global count).
- `jarvis-tools.get_overdue_tasks` reads `task.concept` but concept lives in `metadata.concept` (→ undefined).
- `tasks-utils.generateTasksForPlan` reads `item.cta` (lowercase) but calendar stores `CTA` → `metadata.cta` usually empty.
- `qc-utils` uses user-scoped client (RLS-sensitive) while most jobs use service role.
- `execute_confirmed_action` `save_prompt_template` branch unreachable.
- `/api/cron/reporting` runs autopilot, not reporting (misnamed).
- Higgsfield `activeJobs` in-memory Map breaks multi-instance deploys.
- AGENTS.md §7 machine-id mapping contradicts `higgsfield-config.ts` (config is truth).
- `gen_costs` logged before Higgsfield submit success (failed submit still bills).

## 11. Environment variables (full set)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `WHATSAPP_TOKEN`/`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_VOICE_REPLIES`, `WHATSAPP_TTS_VOICE`(onyx), `FOUNDER_WHATSAPP_NUMBER`, `FOUNDER_PHONE_NUMBER`, `HIGGSFIELD_ACCESS_TOKEN`/`HIGGSFIELD_CLIENT_ID`(claude)/`HIGGSFIELD_CLIENT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `CRON_ENABLED`, `NEXT_PUBLIC_APP_URL`, `DOMAIN`, `NODE_ENV`.
⚠️ Founder-number env is inconsistent: briefing uses `FOUNDER_WHATSAPP_NUMBER`; overdue/learning use `FOUNDER_PHONE_NUMBER`; autopilot uses DB `profiles.phone`.

## 12. Deploy

Docker (3-stage node:20-alpine, standalone) + Caddy (auto-HTTPS for `bron.digital`) via `docker-compose.yml`. `deploy/setup.sh` (VPS bootstrap) + `deploy/deploy.sh` (pull/build/up + `/api/health` check). Repo: `git@github.com:kezvin5718/TBW-Agentic-Ai.git`.

---

## 13. To make it production-real (candidate roadmap)

1. **Wire real Meta Insights** into `ads-autopilot.ts` to replace simulated `metrics_daily`; extract `× 200` into one shared, brand-configurable constant.
2. Replace hardcoded stubs: Jarvis `generate_plan`/`draft_weekly_report`, `tasks/[id]/generate-image`, `send_to_client` (actually send).
3. Configure the full API-key set so integrations stop falling back to mock mode.
4. Move Higgsfield `activeJobs` to durable storage (DB) for multi-instance safety.
5. Reconcile AGENTS.md §7 machine-id mapping with `higgsfield-config.ts`.
6. Fix the latent bugs in §10; set `ENCRYPTION_KEY` and rotate the committed fallback key.
