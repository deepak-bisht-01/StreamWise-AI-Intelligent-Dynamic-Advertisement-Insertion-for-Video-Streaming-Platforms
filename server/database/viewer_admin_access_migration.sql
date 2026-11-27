-- Run after the video, ad-analysis, personalization, and manual-auth migrations.
-- The API enforces the custom StreamWise roles and uses the server-only service
-- role key; browser clients must not be able to query source video rows.

begin;

alter table public.videos enable row level security;
alter table public.ad_slots enable row level security;

drop policy if exists "Allow public read on videos" on public.videos;
drop policy if exists "Allow public insert on videos" on public.videos;
drop policy if exists "Allow public update on videos" on public.videos;
drop policy if exists "Allow public delete on videos" on public.videos;
drop policy if exists "Allow public read on ad_slots" on public.ad_slots;
drop policy if exists "Allow public insert on ad_slots" on public.ad_slots;
drop policy if exists "Allow public delete on ad_slots" on public.ad_slots;

revoke all privileges on public.videos, public.ad_slots from public, anon, authenticated;
grant select, insert, update, delete on public.videos, public.ad_slots to service_role;

revoke execute on function public.get_library_stats() from public, anon, authenticated;
grant execute on function public.get_library_stats() to service_role;
revoke execute on function public.search_videos(text) from public, anon, authenticated;
grant execute on function public.search_videos(text) to service_role;
revoke select on public.video_stats from public, anon, authenticated;
grant select on public.video_stats to service_role;

commit;

notify pgrst, 'reload schema';
