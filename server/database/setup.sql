-- ============================================================
-- StreamWise AI — Supabase setup (run in SQL Editor)
-- Fresh project: run schema.sql (or this whole file once)
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

drop table if exists public.videos cascade;

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) >= 3 and char_length(title) <= 120),
  description text not null check (char_length(description) >= 10 and char_length(description) <= 2000),
  video_url text not null check (video_url ~* '^https?://'),
  thumbnail_url text not null check (thumbnail_url ~* '^https?://'),
  cloudinary_video_id text not null,
  cloudinary_thumbnail_id text not null,
  duration double precision not null default 0 check (duration >= 0),
  file_size integer not null default 0 check (file_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx on public.videos (created_at desc);
create index if not exists videos_title_idx on public.videos (title);
create index if not exists videos_duration_idx on public.videos (duration);
create index if not exists videos_file_size_idx on public.videos (file_size);
create index if not exists videos_cloudinary_video_id_idx on public.videos (cloudinary_video_id);
create index if not exists videos_cloudinary_thumbnail_id_idx on public.videos (cloudinary_thumbnail_id);
create index if not exists videos_created_title_idx on public.videos (created_at desc, title);

alter table public.videos enable row level security;

create policy "Allow public read on videos"
  on public.videos for select using (true);

create policy "Allow public insert on videos"
  on public.videos for insert with check (true);

create policy "Allow public update on videos"
  on public.videos for update using (true) with check (true);

create policy "Allow public delete on videos"
  on public.videos for delete using (true);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_videos_updated_at on public.videos;
create trigger update_videos_updated_at
  before update on public.videos
  for each row
  execute function public.update_updated_at_column();

create or replace function public.get_library_stats()
returns json as $$
declare
  total_videos integer;
  total_duration double precision;
  total_storage bigint;
begin
  select
    count(*)::integer,
    coalesce(sum(duration), 0),
    coalesce(sum(file_size), 0)::bigint
  into total_videos, total_duration, total_storage
  from public.videos;

  return json_build_object(
    'totalVideos', total_videos,
    'totalDuration', total_duration,
    'totalStorage', total_storage
  );
end;
$$ language plpgsql stable;

grant execute on function public.get_library_stats() to anon, authenticated;

create or replace function public.search_videos(search_term text)
returns setof public.videos as $$
begin
  return query
  select *
  from public.videos
  where
    title ilike '%' || search_term || '%'
    or description ilike '%' || search_term || '%'
  order by created_at desc;
end;
$$ language plpgsql stable;

grant execute on function public.search_videos(text) to anon, authenticated;
