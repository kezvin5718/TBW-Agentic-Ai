-- Automatic captions (founder's spec, 24 Nov 2026).
-- Every post / reel / carousel is queued for a caption the moment it is
-- uploaded — QC or no QC — and again when its media is replaced. The app's
-- background job (src/lib/caption-worker.ts) does the reading and writing.
-- Safe to run more than once.

alter table public.creative_uploads
  add column if not exists caption_source text,            -- 'ai' | 'manual'
  add column if not exists caption_attempts integer not null default 0,
  add column if not exists caption_error text,
  add column if not exists caption_started_at timestamptz,
  add column if not exists caption_updated_at timestamptz,
  add column if not exists caption_media_key text,         -- the media version the caption was written for
  add column if not exists reading_key text,               -- the media version the stored reading came from
  add column if not exists audio_transcript text;          -- what is said in a video

create index if not exists creative_uploads_caption_queue_idx
  on public.creative_uploads (caption_status, created_at)
  where caption_status in ('pending', 'analysing', 'writing', 'failed', 'no_contact');

-- Every attempt, every failure, every hand edit — nothing is dropped silently.
create table if not exists public.caption_job_log (
  id bigserial primary key,
  upload_id uuid references public.creative_uploads(id) on delete cascade,
  attempt integer,
  stage text not null,   -- started | read | written | failed | gave_up | interrupted | no_contact | kept_manual | superseded | manual_edit
  message text,
  created_at timestamptz not null default now()
);
create index if not exists caption_job_log_upload_idx on public.caption_job_log (upload_id, created_at desc);
alter table public.caption_job_log enable row level security;   -- server (service role) only

-- The queue. Runs on every insert, and on an update that replaces the file.
create or replace function public.creative_uploads_caption_queue() returns trigger
language plpgsql as $$
declare
  eligible boolean := new.festival_id is null and coalesce(new.content_type, 'post') not in ('story', 'thumbnail');
begin
  if tg_op = 'INSERT' then
    if not eligible then
      new.caption_status := 'skipped';
    elsif coalesce(btrim(new.caption), '') <> '' then
      -- A caption typed at upload is the designer's own.
      new.caption_source := coalesce(new.caption_source, 'manual');
      new.caption_status := 'done';
      new.caption_media_key := new.file_url;
    else
      new.caption_status := 'pending';
      new.caption_attempts := 0;
    end if;
    return new;
  end if;

  -- The media was replaced: an AI caption is written again; a hand-written one stays.
  if new.file_url is distinct from old.file_url and eligible and coalesce(new.caption_source, '') <> 'manual' then
    new.caption_status := 'pending';
    new.caption_attempts := 0;
    new.caption_error := null;
  end if;
  return new;
end $$;

drop trigger if exists creative_uploads_caption_queue on public.creative_uploads;
create trigger creative_uploads_caption_queue
  before insert or update of file_url on public.creative_uploads
  for each row execute function public.creative_uploads_caption_queue();

-- Existing rows.
-- Captions already written by the writer are the AI's.
update public.creative_uploads
   set caption_source = 'ai', caption_media_key = file_url
 where caption_source is null and caption_status = 'done' and coalesce(btrim(caption), '') <> '';
-- A caption present without the writer ever running was typed by a person.
update public.creative_uploads
   set caption_source = 'manual', caption_status = 'done', caption_media_key = file_url
 where caption_source is null and coalesce(btrim(caption), '') <> '' and coalesce(caption_status, 'none') <> 'done';
-- Stories, thumbnails and festival creatives never carry one.
update public.creative_uploads
   set caption_status = 'skipped'
 where (festival_id is not null or content_type in ('story', 'thumbnail'))
   and coalesce(caption_status, 'none') in ('none', 'failed', 'no_contact');
-- No backfill. The founder's call (25 Nov): only NEW uploads get an automatic
-- caption; everything uploaded before this went live stays as it was. (A
-- backfill ran for a few minutes and was reversed before any caption was
-- written: those rows went back to caption_status 'none'.)
