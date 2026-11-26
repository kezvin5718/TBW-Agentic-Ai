-- Automatic carousels from filenames (founder's spec, 26 Nov 2026).
-- "Post 1A", "Post 1B", "Post 1C" are post 1, a carousel, slides A–C; "Post 3"
-- is post 3. The app groups the slides (src/lib/post-naming.ts and
-- api/content-hub/carousel-detect); the database keeps the post number on every
-- creative and the letter on every slide, so the order survives refreshes, QC,
-- scheduling and publishing. Safe to run more than once.

alter table public.creative_uploads add column if not exists post_number integer;
alter table public.carousel_slides add column if not exists slide_label text;

-- One slide per letter in a carousel — a second "B" can never sneak in.
create unique index if not exists carousel_slides_upload_label_key
  on public.carousel_slides (upload_id, slide_label) where slide_label is not null;

create index if not exists creative_uploads_post_number_idx
  on public.creative_uploads (client_id, content_type, post_number) where post_number is not null;

-- The post number a filename carries: "Post 3B.png" → 3, "Reel 4.mp4" → 4,
-- "IMG_4521.jpg" / "1080x1350.png" / "design v2.png" → null. The same rules as
-- parsePostName in src/lib/post-naming.ts.
create or replace function public.post_number_from_name(name text) returns integer
language plpgsql immutable as $$
declare
  stem text;
  m text[];
begin
  if name is null then return null; end if;
  stem := regexp_replace(name, '\.[A-Za-z0-9]{2,5}$', '');
  stem := btrim(regexp_replace(stem, '(\s*\(\d+\)|[\s_-]*copy([\s_-]*\d+)?)\s*$', '', 'i'));
  m := regexp_match(stem, '^(.*?)(?<!\d)(\d{1,3})[\s_.-]*([A-Za-z])?$');
  if m is null then return null; end if;
  if m[1] ~* '(^|[^a-z])(v|ver|version|rs|inr|size|no|x)[\s_.-]*$' then return null; end if;
  return m[2]::integer;
end $$;

-- Every upload path gets its number without having to remember to set it.
create or replace function public.creative_uploads_post_number() returns trigger
language plpgsql as $$
begin
  if new.post_number is null then
    new.post_number := public.post_number_from_name(new.file_name);
  end if;
  return new;
end $$;

drop trigger if exists creative_uploads_post_number on public.creative_uploads;
create trigger creative_uploads_post_number
  before insert on public.creative_uploads
  for each row execute function public.creative_uploads_post_number();

-- Creatives still waiting to be published take their number now, so the
-- publishing list can run in order. Posted ones are left as they are.
update public.creative_uploads
   set post_number = public.post_number_from_name(file_name)
 where post_number is null and status in ('uploaded', 'rejected');
