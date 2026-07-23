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
