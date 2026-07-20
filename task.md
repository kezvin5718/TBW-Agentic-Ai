# Tasks: Bron Assistant Voice & Image Studio Prompt Templates

- [x] Database Schema Extension
  - [x] Add `voice_audit` SQL definition to `/supabase/schema.sql`
  - [x] Execute SQL schema changes in the database
- [x] Speech Integrations Services
  - [x] Create `/src/lib/integrations/stt.ts` for OpenAI Whisper and TTS
  - [x] Update `/src/lib/integrations/whatsapp.ts` for media download, upload, and audio sends
- [x] WhatsApp Webhook & Simulator
  - [x] Update Webhook route `/src/app/api/webhooks/whatsapp/route.ts` to handle voice messages, transcribe them, log to audit, and enforce typed YES confirmation
  - [x] Update Webhook Simulator `/src/app/dashboard/whatsapp-simulator/page.tsx` to simulate voice note payloads
- [x] Bron Dashboard Page Interface
  - [x] Update page `/src/app/dashboard/jarvis/page.tsx` to include mic transcription and TTS browser speaker outputs
  - [x] Update system prompts in `/src/lib/jarvis.ts` with safety rules
- [x] Voice Verification & Build checks
  - [x] Confirm Next.js compilation succeeds with zero warnings

- [x] Image Studio Prompt Templates
  - [x] Add `prompt_templates` SQL schema to `/supabase/schema.sql`
  - [x] Update `/api/seed` route to insert the 5 default templates
  - [x] Create `/api/production/templates` CRUD route handlers
  - [x] Implement ratio parameter handling in `generate-image` endpoint
  - [x] Build Prompt Template Settings Manager in settings page (CRUD + Sort arrow reordering)
  - [x] Integrate template chips, placeholder auto-fill from brand brain, ratio selector, and "Save as template" button in Image Studio card drawer
  - [x] Confirm Next.js compilation builds cleanly with zero errors

- [x] Standalone Image Studio Module
  - [x] Add `studio_generations` SQL schema to `/supabase/schema.sql`
  - [x] Create `/src/lib/higgsfield-config.ts` configuration file
  - [x] Create `/api/production/higgsfield/upload` endpoint
  - [x] Create `/api/production/higgsfield/generate` endpoint (Respecting credits check and logging to `gen_costs`)
  - [x] Create `/api/production/higgsfield/status/[jobId]` polling status endpoint
  - [x] Create `/api/production/higgsfield/history` persistence endpoint
  - [x] Integrate "Image Studio" link inside sidebar navigation `/src/app/dashboard/layout.tsx`
  - [x] Build `/src/app/dashboard/image-studio/page.tsx` standalone image studio view
  - [x] Confirm Next.js compilation builds successfully with 0 errors

- [x] Task Pipeline Studio Integration
  - [x] Add `task_id` reference to `studio_generations` table definition in `/supabase/schema.sql`
  - [x] Update `/api/production/higgsfield/generate` route to receive and link `taskId`
  - [x] Update `/api/production/higgsfield/status/[jobId]` route to save `task_id`
  - [x] Update `/src/app/dashboard/production/page.tsx` task drawer to show attempts and replace inline image generation panel with "Open in Image Studio"
  - [x] Refactor `/src/app/dashboard/image-studio/page.tsx` with Task Mode features (Banner, Quick-Attach, Template presetting chips with Undo, and Task Upload pipeline trigger)
  - [x] Confirm clean build with zero TypeScript compiler errors

- [x] Batch Generation in Image Studio
  - [x] Extend `/api/production/higgsfield/generate` to process dynamic upload arrays (1 to 10)
  - [x] Refactor `/api/production/higgsfield/status/[jobId]` to resolve mock visuals in order matching reference images list
  - [x] Adjust upload grid in `/src/app/dashboard/image-studio/page.tsx` to dynamically grow with one "+" add slot
  - [x] Display dynamic cost estimate text matching model costs
  - [x] Verify compilation passes successfully

- [x] Separate Style and Product Upload Sections
  - [x] Separate uploads into **Section 1: Style Reference** (exactly 1 optional slot) and **Section 2: Product Images** (1 to 10 required slots)
  - [x] Update `/api/production/higgsfield/generate` and `/status/[jobId]` to distinguish between Style Reference and Product Images lists
  - [x] Disable Generate action until at least 1 product image is present
  - [x] Validate zero typecheck errors

- [x] Client Brand Brain Knowledge Import
  - [x] Add `knowledge_import_audit` table schema to `/supabase/schema.sql`
  - [x] Install `adm-zip` zip extraction package in workspace
  - [x] Build `/api/brand-brain/[id]/import` POST (MODEL_SMART file parsing & text extraction) and PUT (Save approved checklist items, regenerate brief, log audit entry) API handlers
  - [x] Update `/api/brand-brain/[id]/brief` POST to incorporate results logs (campaign learnings)
  - [x] Add **Import Knowledge** button, file upload slots, progress loaders, and 4 checklist groups to `/src/app/dashboard/brand-brain/[id]/page.tsx`
  - [x] Verify type safety and zero compiler errors

- [x] Shared Agency Brain Layer
  - [x] Add `agency_brain` SQL schema to `/supabase/schema.sql`
  - [x] Create `/src/lib/agency-brain.ts` context assembly digest generator helper
  - [x] Inject `agencyBrainDigest` and `brand_brief` in monthly strategy planning API
  - [x] Inject `agencyBrainDigest` and `brand_brief` in content calendar planning API
  - [x] Inject `agencyBrainDigest` and `brand_brief` in ad budget planning API
  - [x] Inject `agencyBrainDigest` and `brand_brief` in Meta campaign media planning API
  - [x] Inject `agencyBrainDigest` in task creative script/video draft generator API
  - [x] Extend `/api/cron/learning` loop with the generalizable, anonymized patterns extraction and confidence-upgrade save steps
  - [x] Build founder-only `/src/app/dashboard/agency-brain/page.tsx` CRUD viewer
  - [x] Add sidebar navigation link inside `/src/app/dashboard/layout.tsx` (founder-only visibility check)
  - [x] Update `/AGENTS.md` with two-layer brain isolation safety rule
  - [x] Write isolation unit test script at `/src/__tests__/isolation.test.js` and run it
  - [x] Validate zero compilation errors on Next.js build
