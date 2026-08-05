-- Migration SQL for refactoring Festival Post category to a global configuration

-- 1. Ensure engine, category_type, and default_model columns exist (safe schema check)
ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS engine TEXT DEFAULT 'higgsfield' NOT NULL;

ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS category_type TEXT DEFAULT 'standard' NOT NULL;

ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS default_model TEXT;

-- 2. Remove the "Festival Post" row from style categories table
DELETE FROM public.generation_categories WHERE name = 'Festival Post';

-- 3. Seed/insert the global Festival Post scaffold configuration into agency_settings
INSERT INTO public.agency_settings (key, value)
VALUES (
  'festival_post_config',
  '{"scaffold": {"prompt": "A premium, minimalist 9:16 story-format festive creative for {festival_name}. Design style: {festival_details}. Aesthetic guidelines: use clean motifs and rich colors appropriate to {festival_name}, ensuring elegant negative space and safe margins for the 9:16 frame. Text Wish: {wish_text}. Tagline: {tagline_text}. Instructions: Render the typography clean and keep the text strings extremely short and exactly spelled as specified. If Wish or Tagline is empty, render NO text in the creative. Do not invent any text. Place the product seamlessly in the scene, adapting the styling to the product segments. House style: premium, elegant, minimal, no clutter."}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 4. Extend client credentials to support Facebook Page ID
ALTER TABLE public.client_credentials ADD COLUMN IF NOT EXISTS meta_page_id TEXT;

-- 5. Create scheduled_posts table
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  media_url TEXT NOT NULL,
  caption TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  platform_post_id TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Select scheduled posts" ON public.scheduled_posts;
DROP POLICY IF EXISTS "Manage scheduled posts" ON public.scheduled_posts;

-- Policies for client/founder/employee access
CREATE POLICY "Select scheduled posts" ON public.scheduled_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage scheduled posts" ON public.scheduled_posts
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );

-- Add resolution column to gen_costs table
ALTER TABLE public.gen_costs ADD COLUMN IF NOT EXISTS resolution TEXT;

-- Add locally_unrecoverable column to studio_generations table
ALTER TABLE public.studio_generations ADD COLUMN IF NOT EXISTS locally_unrecoverable BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Founder Zone: personal portfolio theses + decision journal
-- (applied to remote 2026-08-04 via migration founder_zone_theses_journal)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.founder_theses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text UNIQUE NOT NULL,
  name text NOT NULL DEFAULT '',
  thesis text NOT NULL DEFAULT '',
  wrong_if text NOT NULL DEFAULT '',
  checkpoints text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'on_thesis',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.founder_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  entry_type text NOT NULL DEFAULT 'note',
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT ''
);

ALTER TABLE public.founder_theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_journal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder only theses" ON public.founder_theses;
CREATE POLICY "Founder only theses" ON public.founder_theses
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'));

DROP POLICY IF EXISTS "Founder only journal" ON public.founder_journal;
CREATE POLICY "Founder only journal" ON public.founder_journal
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'));

-- ============================================================
-- Founder Zone: holdings moved to DB (applied 2026-08-04 via
-- migration founder_holdings_table_and_seed, seeded with 42 positions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.founder_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL DEFAULT 'Main',
  ticker text NOT NULL,
  name text NOT NULL DEFAULT '',
  avg numeric NOT NULL DEFAULT 0,
  qty numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account, ticker)
);

ALTER TABLE public.founder_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder only holdings" ON public.founder_holdings;
CREATE POLICY "Founder only holdings" ON public.founder_holdings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'));

-- ============================================================
-- Founder Zone: EOD portfolio history log (applied 2026-08-04
-- via migration founder_market_log)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.founder_market_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'eod',
  total_value numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS founder_market_log_logged_at_idx
  ON public.founder_market_log (logged_at DESC);

ALTER TABLE public.founder_market_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder only market log" ON public.founder_market_log;
CREATE POLICY "Founder only market log" ON public.founder_market_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'founder'));


-- ============================================================
-- Applied 2026-08-05 via Supabase MCP as migration "team_tasks_module"
-- Team Tasks / CRM module: tasks become the single master task table
-- (plan tasks keep plan_id; team tasks have plan_id NULL). Also creates
-- team_members directory. Data import (49 clients, 21 members, 113 tasks
-- from "TBW Worksheet" Excel) was run separately as one-time inserts.
-- ============================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_name TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

UPDATE public.tasks SET source = 'plan' WHERE plan_id IS NOT NULL AND source = 'manual';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('plan', 'manual', 'whatsapp', 'excel_import'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_type_check
  CHECK (type IN ('copy', 'image', 'video', 'ads', 'design', 'video_edit', 'ai_video', 'script', 'planning', 'packaging', 'print', 'other'));

CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON public.tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_name ON public.tasks(assignee_name);

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  role_title TEXT,
  department TEXT,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read team members" ON public.team_members;
CREATE POLICY "Authenticated read team members"
  ON public.team_members FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Founder/Employee manage team members" ON public.team_members;
CREATE POLICY "Founder/Employee manage team members"
  ON public.team_members FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );
