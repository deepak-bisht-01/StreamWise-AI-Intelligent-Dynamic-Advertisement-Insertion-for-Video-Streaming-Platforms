-- Enhanced Lumina Video Library Database Schema
-- This file contains the improved database schema with better constraints, indexes, and performance optimizations

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Drop existing table if it exists (for migration purposes)
drop table if exists public.videos cascade;

-- Create videos table with enhanced constraints
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

-- Create optimized indexes
create index if not exists videos_created_at_idx on public.videos (created_at desc);
create index if not exists videos_title_idx on public.videos (title);
create index if not exists videos_duration_idx on public.videos (duration);
create index if not exists videos_file_size_idx on public.videos (file_size);
create index if not exists videos_cloudinary_video_id_idx on public.videos (cloudinary_video_id);
create index if not exists videos_cloudinary_thumbnail_id_idx on public.videos (cloudinary_thumbnail_id);

-- Create composite index for common queries
create index if not exists videos_created_title_idx on public.videos (created_at desc, title);

-- Enable Row Level Security
alter table public.videos enable row level security;

-- Create policies for public access (as per current architecture)
-- Note: In production, these should be replaced with authenticated policies
create policy "Allow public read on videos"
  on public.videos for select
  using (true);

create policy "Allow public insert on videos"
  on public.videos for insert
  with check (true);

create policy "Allow public delete on videos"
  on public.videos for delete
  using (true);

-- Create function to automatically update updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger to automatically update updated_at
create trigger update_videos_updated_at
  before update on public.videos
  for each row
  execute function public.update_updated_at_column();

-- Create optimized function for library stats
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

-- Grant execute permission on the function
grant execute on function public.get_library_stats() to anon, authenticated;

-- Create function for video search (optional enhancement)
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

-- Grant execute permission on search function
grant execute on function public.search_videos(text) to anon, authenticated;

-- Create view for video statistics (optional enhancement)
create or replace view public.video_stats as
select 
  id,
  title,
  duration,
  file_size,
  created_at,
  case 
    when duration > 0 then file_size / duration 
    else 0 
  end as bitrate
from public.videos;

-- Grant select permission on the view
grant select on public.video_stats to anon, authenticated;

-- Add comments for documentation
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

-- Insert sample data for testing (optional)
-- insert into public.videos (title, description, video_url, thumbnail_url, cloudinary_video_id, cloudinary_thumbnail_id, duration, file_size)
-- values 
--   ('Sample Video 1', 'This is a sample video for testing purposes', 'https://example.com/video1.mp4', 'https://example.com/thumb1.jpg', 'sample_video_1', 'sample_thumb_1', 120.5, 5242880),
--   ('Sample Video 2', 'Another sample video for testing', 'https://example.com/video2.mp4', 'https://example.com/thumb2.jpg', 'sample_video_2', 'sample_thumb_2', 180.0, 10485760);