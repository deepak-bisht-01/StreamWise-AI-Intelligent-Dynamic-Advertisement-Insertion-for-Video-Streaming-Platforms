-- Migration script to enhance existing Lumina database schema
-- Run this in Supabase SQL Editor to upgrade your existing database

-- Step 1: Backup existing data (run this first if you have important data)
-- create table public.videos_backup as select * from public.videos;

-- Step 2: Add constraints to existing table
alter table public.videos 
  add constraint videos_title_length_check 
  check (char_length(title) >= 3 and char_length(title) <= 120);

alter table public.videos 
  add constraint videos_description_length_check 
  check (char_length(description) >= 10 and char_length(description) <= 2000);

alter table public.videos 
  add constraint videos_url_format_check 
  check (video_url ~* '^https?://');

alter table public.videos 
  add constraint videos_thumbnail_url_format_check 
  check (thumbnail_url ~* '^https?://');

alter table public.videos 
  add constraint videos_duration_check 
  check (duration >= 0);

alter table public.videos 
  add constraint videos_file_size_check 
  check (file_size >= 0);

-- Step 3: Add performance indexes
create index if not exists videos_duration_idx on public.videos (duration);
create index if not exists videos_file_size_idx on public.videos (file_size);
create index if not exists videos_cloudinary_video_id_idx on public.videos (cloudinary_video_id);
create index if not exists videos_cloudinary_thumbnail_id_idx on public.videos (cloudinary_thumbnail_id);
create index if not exists videos_created_title_idx on public.videos (created_at desc, title);

-- Step 4: Create automatic updated_at trigger
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

-- Step 5: Create optimized library stats function
create or replace function public.get_library_stats()
returns json as $$
declare
  total_videos integer;
  total_duration double precision;
  total_storage bigint;
begin
  select 
    count(*) as total_videos,
    coalesce(sum(duration), 0) as total_duration,
    coalesce(sum(file_size), 0) as total_storage
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

-- Step 6: Create search function (optional enhancement)
create or replace function public.search_videos(search_term text)
returns setof public.videos as $$
begin
  return query
  select *
  from public.videos
  where 
    title ilike '%' || search_term || '%' or
    description ilike '%' || search_term || '%'
  order by created_at desc;
end;
$$ language plpgsql stable;

grant execute on function public.search_videos(text) to anon, authenticated;

-- Step 7: Add comments for documentation
comment on table public.videos is 'Stores video metadata and Cloudinary asset references';
comment on column public.videos.id is 'Unique identifier for the video record';
comment on column public.videos.title is 'Video title (3-120 characters)';
comment on column public.videos.description is 'Video description (10-2000 characters)';
comment on column public.videos.video_url is 'Cloudinary URL for the video file';
comment on column public.videos.thumbnail_url is 'Cloudinary URL for the thumbnail image';
comment on column public.videos.cloudinary_video_id is 'Cloudinary public ID for the video';
comment on column public.videos.cloudinary_thumbnail_id is 'Cloudinary public ID for the thumbnail';
comment on column public.videos.duration is 'Video duration in seconds';
comment on column public.videos.file_size is 'Video file size in bytes';
comment on column public.videos.created_at is 'Timestamp when the video was created';
comment on column public.videos.updated_at is 'Timestamp when the video was last updated';

-- Verification queries (run these to verify the migration)
-- select * from public.videos limit 1;
-- select count(*) from public.videos;
-- select public.get_library_stats();