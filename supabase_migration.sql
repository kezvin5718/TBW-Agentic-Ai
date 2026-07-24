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
