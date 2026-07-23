-- Migration SQL for adding "Festival Post" category columns and data

-- 1. Add engine and category_type columns to generation_categories table
ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS engine TEXT DEFAULT 'higgsfield' NOT NULL;

ALTER TABLE public.generation_categories 
ADD COLUMN IF NOT EXISTS category_type TEXT DEFAULT 'standard' NOT NULL;

-- 2. Seed the Festival Post category
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.generation_categories WHERE name = 'Festival Post') THEN
    INSERT INTO public.generation_categories (
      name, 
      description, 
      category_type, 
      engine, 
      default_aspect_ratio, 
      scaffold_json, 
      sort_order, 
      is_active
    )
    VALUES (
      'Festival Post',
      'Premium story-format festive creatives with integrated wishes, taglines, and optional product placement.',
      'festival_post',
      'openai',
      '9:16',
      '{"prompt": "A premium, minimalist 9:16 story-format festive creative for {festival_name}. Design style: {festival_details}. Aesthetic guidelines: use clean motifs and rich colors appropriate to {festival_name}, ensuring elegant negative space and safe margins for the 9:16 frame. Text Wish: {wish_text}. Tagline: {tagline_text}. Instructions: Integrated typography must read exactly as specified. If Wish or Tagline is empty, render NO text in the creative. Do not invent any text. If a product description is attached, place the product seamlessly in the scene, adapting the styling to the product segments. House style: premium, elegant, minimal, no clutter."}',
      3,
      true
    );
  END IF;
END $$;
