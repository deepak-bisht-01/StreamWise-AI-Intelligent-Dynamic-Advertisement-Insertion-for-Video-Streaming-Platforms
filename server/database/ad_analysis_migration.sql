-- StreamWise AI: billboard / blank-wall analysis for every video.
-- Run once in Supabase SQL Editor. Safe to re-run.

alter table public.videos
  add column if not exists analysis_status text not null default 'pending',
  add column if not exists analysis_error text,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_meta jsonb;

-- Existing rows get 'pending' from the default, so the server's startup sweep
-- will analyse every video that was uploaded before this feature existed.

alter table public.videos drop constraint if exists videos_analysis_status_check;
alter table public.videos add constraint videos_analysis_status_check
  check (analysis_status in ('pending','processing','completed','no_slots','failed'));

create index if not exists videos_analysis_status_idx on public.videos (analysis_status);

create table if not exists public.ad_slots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  slot_number integer not null,
  rank_order integer,
  kind text not null,                        -- existing_board | blank_surface
  start_sec double precision not null,
  end_sec double precision not null,
  duration_sec double precision not null,
  x1 integer not null, y1 integer not null, x2 integer not null, y2 integer not null,
  frame_width integer not null,              -- coordinate space of x/y (normalized video)
  frame_height integer not null,
  ranking_score double precision,
  track jsonb,                               -- [[time_sec,x1,y1,x2,y2], ...] per frame
  created_at timestamptz not null default now()
);

create index if not exists ad_slots_video_idx on public.ad_slots (video_id, start_sec);

alter table public.ad_slots enable row level security;

-- The API uses the anon key (no auth), same approach as the videos table.
drop policy if exists "Allow public update on videos" on public.videos;
create policy "Allow public update on videos" on public.videos for update using (true) with check (true);

drop policy if exists "Allow public read on ad_slots" on public.ad_slots;
create policy "Allow public read on ad_slots" on public.ad_slots for select using (true);
drop policy if exists "Allow public insert on ad_slots" on public.ad_slots;
create policy "Allow public insert on ad_slots" on public.ad_slots for insert with check (true);
drop policy if exists "Allow public delete on ad_slots" on public.ad_slots;
create policy "Allow public delete on ad_slots" on public.ad_slots for delete using (true);
