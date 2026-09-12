-- ============================================================
-- StreamWise AI — Useful Supabase queries
-- Run these in SQL Editor after setup.sql
-- ============================================================

-- All videos (newest first)
select *
from public.videos
order by created_at desc;

-- Count videos
select count(*) as total_videos
from public.videos;

-- One video by id (replace with real uuid)
-- select * from public.videos where id = '00000000-0000-0000-0000-000000000000';

-- Paginated list (page 1, 12 items)
select *
from public.videos
order by created_at desc
limit 12 offset 0;

-- Search by title / description
select *
from public.search_videos('sample');

-- Or without RPC:
select *
from public.videos
where title ilike '%sample%'
   or description ilike '%sample%'
order by created_at desc;

-- Library stats (used by the API)
select public.get_library_stats();

-- Related videos (exclude one id)
-- select * from public.videos
-- where id <> '00000000-0000-0000-0000-000000000000'
-- order by created_at desc
-- limit 6;

-- Insert sample row (for testing UI only — use real Cloudinary URLs in production)
insert into public.videos (
  title,
  description,
  video_url,
  thumbnail_url,
  cloudinary_video_id,
  cloudinary_thumbnail_id,
  duration,
  file_size
) values (
  'Sample Demo Video',
  'This is a sample description for StreamWise AI testing.',
  'https://res.cloudinary.com/demo/video/upload/dog.mp4',
  'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  'demo/dog',
  'demo/sample',
  12.5,
  1048576
)
returning *;

-- Update title
-- update public.videos
-- set title = 'Updated Title'
-- where id = '00000000-0000-0000-0000-000000000000'
-- returning *;

-- Delete one video
-- delete from public.videos
-- where id = '00000000-0000-0000-0000-000000000000';

-- Delete all videos (careful!)
-- delete from public.videos;
