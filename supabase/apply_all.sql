--
-- tbw-os Consolidated Schema & Policies Setup
-- Run this in your Supabase SQL Editor to configure all tables.
--

-- Clean up all existing RLS policies in the public schema to prevent stale policy compilation errors
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname, tablename, schemaname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- Safely rename campaigns.campaign_id to id if it exists from an old schema
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'campaign_id'
  ) THEN
    ALTER TABLE public.campaigns RENAME COLUMN campaign_id TO id;
  END IF;
END $$;

---------------------------------------------------------
-- 1. PROFILES & ROLE SETUP
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('founder', 'employee', 'client')),
  brand_name TEXT, -- Associates a client with a specific brand view
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are viewable by authenticated users" 
  ON public.profiles FOR SELECT 
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE 
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Founders can manage all profiles" ON public.profiles;
CREATE POLICY "Founders can manage all profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, brand_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'name', ''),
    COALESCE(new.raw_user_meta_data ->> 'role', 'client'),
    new.raw_user_meta_data ->> 'brand_name'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to sync profile edits back to auth metadata
CREATE OR REPLACE FUNCTION public.sync_profile_to_auth_users()
RETURNS trigger AS $$
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    json_build_object('role', new.role, 'brand_name', new.brand_name)::jsonb
  WHERE id = new.id;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_updated ON public.profiles;
CREATE TRIGGER on_profile_updated
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_to_auth_users();


---------------------------------------------------------
-- 2. CLIENTS & BRAND BRAIN
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  guidelines_url TEXT,
  social_accounts JSONB DEFAULT '{}'::jsonb,
  products JSONB DEFAULT '[]'::jsonb,
  target_audience TEXT,
  deliverables_per_month INTEGER DEFAULT 0,
  ad_budget NUMERIC DEFAULT 0.0,
  whatsapp_group_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients/Employees select clients" ON public.clients;
CREATE POLICY "Clients/Employees select clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (
        profiles.role = 'founder' OR 
        profiles.role = 'employee' OR 
        (profiles.role = 'client' AND profiles.brand_name = clients.name)
      )
    )
  );

DROP POLICY IF EXISTS "Founder/Employee insert/update clients" ON public.clients;
CREATE POLICY "Founder/Employee insert/update clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


-- Brand Brain table
CREATE TABLE IF NOT EXISTS public.brand_brain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
  colors JSONB DEFAULT '[]'::jsonb,
  fonts JSONB DEFAULT '[]'::jsonb,
  caption_tone TEXT,
  design_preferences JSONB DEFAULT '{}'::jsonb,
  addresses JSONB DEFAULT '[]'::jsonb,
  past_creatives JSONB DEFAULT '[]'::jsonb,
  feedback_log JSONB DEFAULT '[]'::jsonb,
  results_log JSONB DEFAULT '[]'::jsonb,
  brand_brief TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.brand_brain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Viewable based on client access" ON public.brand_brain;
CREATE POLICY "Viewable based on client access"
  ON public.brand_brain FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = brand_brain.client_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee write brand_brain" ON public.brand_brain;
CREATE POLICY "Founder/Employee write brand_brain"
  ON public.brand_brain FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


---------------------------------------------------------
-- 3. PLANS & EXECUTION TASKS
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.monthly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  strategy_summary TEXT,
  content_pillars JSONB DEFAULT '[]'::jsonb,
  content_calendar JSONB DEFAULT '[]'::jsonb,
  budget_summary JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'internal_review', 'sent_to_client', 'approved', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select monthly plans based on client access" ON public.monthly_plans;
CREATE POLICY "Select monthly plans based on client access"
  ON public.monthly_plans FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = monthly_plans.client_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee manage monthly plans" ON public.monthly_plans;
CREATE POLICY "Founder/Employee manage monthly plans"
  ON public.monthly_plans FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


-- Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES public.monthly_plans(id) ON DELETE CASCADE,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('copy', 'image', 'video', 'ads')),
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  draft_content JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select tasks based on plan access" ON public.tasks;
CREATE POLICY "Select tasks based on plan access"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.monthly_plans
      JOIN public.clients ON clients.id = monthly_plans.client_id
      WHERE monthly_plans.id = tasks.plan_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee manage tasks" ON public.tasks;
CREATE POLICY "Founder/Employee manage tasks"
  ON public.tasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


---------------------------------------------------------
-- 4. CREATIVES & AD CAMPAIGNS
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- video, image, carousel
  caption TEXT,
  media_url TEXT,
  qc_status TEXT NOT NULL DEFAULT 'pending' CHECK (qc_status IN ('pending', 'passed', 'failed')),
  founder_approval TEXT NOT NULL DEFAULT 'pending' CHECK (founder_approval IN ('pending', 'approved', 'rejected')),
  client_approval TEXT NOT NULL DEFAULT 'pending' CHECK (client_approval IN ('pending', 'approved', 'rejected')),
  published_at TIMESTAMP WITH TIME ZONE,
  platform_post_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select creatives based on task access" ON public.creatives;
CREATE POLICY "Select creatives based on task access"
  ON public.creatives FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks
      JOIN public.monthly_plans ON monthly_plans.id = tasks.plan_id
      JOIN public.clients ON clients.id = monthly_plans.client_id
      WHERE tasks.id = creatives.task_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee manage creatives" ON public.creatives;
CREATE POLICY "Founder/Employee manage creatives"
  ON public.creatives FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


-- Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  objective TEXT NOT NULL,
  budget_per_day NUMERIC DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  external_campaign_id TEXT,
  control_mode TEXT NOT NULL DEFAULT 'founder_approval_required' CHECK (control_mode IN ('draft_only', 'founder_approval_required', 'auto_within_budget')),
  optimisation_rules JSONB DEFAULT '{
    "scale_condition": { "min_roas": 2.0, "increase_amount": 200, "cap_budget": 5000 },
    "trim_condition": { "max_roas": 1.8, "target_budget": 800, "consecutive_days": 2 },
    "pause_condition": { "max_roas": 1.2, "consecutive_days": 3 }
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select campaigns based on client access" ON public.campaigns;
CREATE POLICY "Select campaigns based on client access"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = campaigns.client_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee manage campaigns" ON public.campaigns;
CREATE POLICY "Founder/Employee manage campaigns"
  ON public.campaigns FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


-- Daily Performance Metrics Table
CREATE TABLE IF NOT EXISTS public.metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  spend NUMERIC NOT NULL DEFAULT 0.0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  results JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(campaign_id, date)
);

ALTER TABLE public.metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select daily metrics based on campaign access" ON public.metrics_daily;
CREATE POLICY "Select daily metrics based on campaign access"
  ON public.metrics_daily FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      JOIN public.clients ON clients.id = campaigns.client_id
      WHERE campaigns.id = metrics_daily.campaign_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee manage metrics" ON public.metrics_daily;
CREATE POLICY "Founder/Employee manage metrics"
  ON public.metrics_daily FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


---------------------------------------------------------
-- 5. APPROVALS & TBW SALES LEADS
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'plan', 'creative', 'campaign'
  entity_id UUID NOT NULL,
  approver_role TEXT NOT NULL CHECK (approver_role IN ('founder', 'client')),
  approver_id UUID REFERENCES auth.users(id),
  channel TEXT NOT NULL DEFAULT 'dashboard' CHECK (channel IN ('dashboard', 'whatsapp')),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('approved', 'rejected', 'pending')),
  feedback_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select approvals based on client access" ON public.approvals;
CREATE POLICY "Select approvals based on client access"
  ON public.approvals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = approvals.client_id
    )
  );

DROP POLICY IF EXISTS "Founder/Employee/Client create approvals" ON public.approvals;
CREATE POLICY "Founder/Employee/Client create approvals"
  ON public.approvals FOR ALL
  TO authenticated
  USING (true);


-- TBW Client Pipeline leads
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'visit_scheduled', 'follow_up', 'converted')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee access leads" ON public.leads;
CREATE POLICY "Founder/Employee access leads"
  ON public.leads FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


---------------------------------------------------------
-- 6. SUPABASE STORAGE SETUP (brand-assets)
---------------------------------------------------------

INSERT INTO storage.buckets (id, name, public) 
VALUES ('brand-assets', 'brand-assets', true) 
ON CONFLICT (id) DO NOTHING;


---------------------------------------------------------
-- 7. WHATSAPP & AGENCY SETTINGS
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_number TEXT NOT NULL,
  message_body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  classification TEXT CHECK (classification IN ('approval', 'rejection', 'change_request', 'question', 'payment_related', 'angry', 'other')),
  reply_draft TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.whatsapp_messages;
CREATE POLICY "Allow select for authenticated users"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow all actions for founder/employee" ON public.whatsapp_messages;
CREATE POLICY "Allow all actions for founder/employee"
  ON public.whatsapp_messages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.role = 'founder' OR profiles.role = 'employee')
    )
  );


CREATE TABLE IF NOT EXISTS public.agency_settings (
  key TEXT PRIMARY KEY,
  value JSONB DEFAULT '{}'::jsonb
);

INSERT INTO public.agency_settings (key, value)
VALUES ('default_assignees', '{"copy": null, "image": null, "video": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;


CREATE TABLE IF NOT EXISTS public.client_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE NOT NULL,
  meta_page_token_encrypted TEXT NOT NULL,
  ig_business_id TEXT NOT NULL,
  other_credentials JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.client_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee access client credentials" ON public.client_credentials;
CREATE POLICY "Founder/Employee access client credentials"
  ON public.client_credentials FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );


ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS media_plan JSONB DEFAULT '{}'::jsonb;


CREATE TABLE IF NOT EXISTS public.ad_ops_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'meta',
  payload JSONB DEFAULT '{}'::jsonb,
  response JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  actor_role TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.ad_ops_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee access ad ops audit logs" ON public.ad_ops_audit;
CREATE POLICY "Founder/Employee access ad ops audit logs"
  ON public.ad_ops_audit FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );

DROP POLICY IF EXISTS "Founder/Employee insert ad ops audit logs" ON public.ad_ops_audit;
CREATE POLICY "Founder/Employee insert ad ops audit logs"
  ON public.ad_ops_audit FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );


ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS optimisation_rules JSONB DEFAULT '{
  "scale_condition": { "min_roas": 2.0, "increase_amount": 200, "cap_budget": 5000 },
  "trim_condition": { "max_roas": 1.8, "target_budget": 800, "consecutive_days": 2 },
  "pause_condition": { "max_roas": 1.2, "consecutive_days": 3 }
}'::jsonb;


CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  week_start_date DATE NOT NULL,
  summary_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_founder_approval' CHECK (status IN ('pending_founder_approval', 'approved', 'sent')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee access weekly reports" ON public.weekly_reports;
CREATE POLICY "Founder/Employee access weekly reports"
  ON public.weekly_reports FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );

DROP POLICY IF EXISTS "Client view own weekly reports" ON public.weekly_reports;
CREATE POLICY "Client view own weekly reports"
  ON public.weekly_reports FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'client' AND
    client_id IN (
      SELECT id FROM public.clients WHERE name = (auth.jwt() -> 'user_metadata' ->> 'brand_name')
    )
  );


---------------------------------------------------------
-- 8. JARVIS FOUNDER ASSISTANT
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jarvis_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'expired', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.jarvis_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender TEXT NOT NULL CHECK (sender IN ('user', 'jarvis')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.jarvis_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_chat_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder all access jarvis pending actions" ON public.jarvis_pending_actions;
CREATE POLICY "Founder all access jarvis pending actions"
  ON public.jarvis_pending_actions FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );

DROP POLICY IF EXISTS "Founder all access jarvis chat history" ON public.jarvis_chat_history;
CREATE POLICY "Founder all access jarvis chat history"
  ON public.jarvis_chat_history FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );


---------------------------------------------------------
-- 9. GEN_COSTS IMAGE GENERATION LOGGER
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gen_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cost NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.gen_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder and Employee all access gen_costs" ON public.gen_costs;
CREATE POLICY "Founder and Employee all access gen_costs"
  ON public.gen_costs FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );


---------------------------------------------------------
-- 10. VOICE_AUDIT LOGGER FOR VOICE INTERACTIONS
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voice_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender TEXT NOT NULL,
  audio_ref TEXT,
  transcription TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.voice_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder all access voice audit" ON public.voice_audit;
CREATE POLICY "Founder all access voice audit"
  ON public.voice_audit FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );


---------------------------------------------------------
-- 11. PROMPT_TEMPLATES TABLE FOR IMAGE STUDIO
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  default_model TEXT NOT NULL CHECK (default_model IN ('nano_banana', 'gpt_image', 'both')),
  default_ratio TEXT NOT NULL DEFAULT '1:1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder all access prompt templates" ON public.prompt_templates;
CREATE POLICY "Founder all access prompt templates"
  ON public.prompt_templates FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );

CREATE POLICY "Employee and Client read prompt templates"
  ON public.prompt_templates FOR SELECT TO authenticated
  USING (true);


-- 12. GENERATION_CATEGORIES TABLE FOR IMAGE STUDIO
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.generation_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  prompt_prefix TEXT DEFAULT '',
  prompt_suffix TEXT DEFAULT '',
  scaffold_json JSONB,
  default_model TEXT,
  default_aspect_ratio TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.generation_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone read active categories" ON public.generation_categories;
CREATE POLICY "Anyone read active categories"
  ON public.generation_categories FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Founder manage categories" ON public.generation_categories;
CREATE POLICY "Founder manage categories"
  ON public.generation_categories FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );


---------------------------------------------------------
-- 12. STUDIO_GENERATIONS STANDALONE STUDIO HISTORY
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.studio_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.generation_categories(id) ON DELETE SET NULL,
  raw_input TEXT,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  ratio TEXT NOT NULL,
  reference_image_url TEXT,
  higgsfield_media_ref TEXT,
  generated_image_url TEXT NOT NULL,
  cost NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.studio_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee read write studio history" ON public.studio_generations;
CREATE POLICY "Founder/Employee read write studio history"
  ON public.studio_generations FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );


---------------------------------------------------------
-- 13. KNOWLEDGE_IMPORT_AUDIT LOGGING
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.knowledge_import_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  imported_entries JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.knowledge_import_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee read write knowledge import audit" ON public.knowledge_import_audit;
CREATE POLICY "Founder/Employee read write knowledge import audit"
  ON public.knowledge_import_audit FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );


---------------------------------------------------------
-- 14. AGENCY_BRAIN (Shared anonymized learnings)
---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agency_brain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('creative_patterns', 'performance_benchmarks', 'platform_learnings', 'prompt_patterns', 'process_rules')),
  content TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('observed_once', 'recurring', 'proven')),
  source_count INTEGER DEFAULT 1 NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.agency_brain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Founder/Employee read agency brain" ON public.agency_brain;
CREATE POLICY "Founder/Employee read agency brain"
  ON public.agency_brain FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('founder', 'employee')
  );

DROP POLICY IF EXISTS "Founder manage agency brain" ON public.agency_brain;
CREATE POLICY "Founder manage agency brain"
  ON public.agency_brain FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'founder'
  );
