-- Migration SQL for adding "Festival Post" category columns and data

-- 1. Add engine and category_type columns to generation_categories table
ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS engine TEXT DEFAULT 'higgsfield' NOT NULL;

-- Ensure default_model exists on generation_categories table (just in case)
ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS default_model TEXT;

ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS category_type TEXT DEFAULT 'standard' NOT NULL;

-- 2. Seed the Festival Post category (or update if already exists)
INSERT INTO public.generation_categories (
  name, 
  description, 
  category_type, 
  engine, 
  default_aspect_ratio, 
  default_model,
  scaffold_json, 
  sort_order, 
  is_active
)
VALUES (
  'Festival Post',
  'Premium story-format festive creatives with integrated wishes, taglines, and optional product placement.',
  'festival_post',
  'higgsfield',
  '9:16',
  'Nano Banana Pro',
  '{"prompt": "A premium, minimalist 9:16 story-format festive creative for {festival_name}. Design style: {festival_details}. Aesthetic guidelines: use clean motifs and rich colors appropriate to {festival_name}, ensuring elegant negative space and safe margins for the 9:16 frame. Text Wish: {wish_text}. Tagline: {tagline_text}. Instructions: Render the typography clean and keep the text strings extremely short and exactly spelled as specified. If Wish or Tagline is empty, render NO text in the creative. Do not invent any text. Place the product seamlessly in the scene, adapting the styling to the product segments. House style: premium, elegant, minimal, no clutter."}',
  3,
  true
)
ON CONFLICT (name) DO UPDATE 
SET 
  engine = 'higgsfield',
  default_model = 'Nano Banana Pro',
  category_type = 'festival_post',
  default_aspect_ratio = '9:16',
  scaffold_json = '{"prompt": "A premium, minimalist 9:16 story-format festive creative for {festival_name}. Design style: {festival_details}. Aesthetic guidelines: use clean motifs and rich colors appropriate to {festival_name}, ensuring elegant negative space and safe margins for the 9:16 frame. Text Wish: {wish_text}. Tagline: {tagline_text}. Instructions: Render the typography clean and keep the text strings extremely short and exactly spelled as specified. If Wish or Tagline is empty, render NO text in the creative. Do not invent any text. Place the product seamlessly in the scene, adapting the styling to the product segments. House style: premium, elegant, minimal, no clutter."}';
