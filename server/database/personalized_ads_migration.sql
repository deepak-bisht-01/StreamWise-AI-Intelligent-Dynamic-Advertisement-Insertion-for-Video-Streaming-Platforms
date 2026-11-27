-- Run after schema.sql and ad_analysis_migration.sql.
-- Adds account profiles, regional brand creatives, and per-viewer render cache.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  location_mode text not null default 'manual' check (location_mode in ('manual', 'gps')),
  country text not null default 'India',
  state text,
  district text,
  city text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  location_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'Viewer'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, 'Viewer'), '@', 1))
from auth.users
on conflict (id) do nothing;

create or replace function public.touch_profile_location()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if row(new.location_mode, new.country, new.state, new.city, new.latitude, new.longitude)
     is distinct from row(old.location_mode, old.country, old.state, old.city, old.latitude, old.longitude) then
    new.location_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists touch_profile_location_before_update on public.profiles;
create trigger touch_profile_location_before_update
  before update on public.profiles
  for each row execute function public.touch_profile_location();

alter table public.profiles enable row level security;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, location_mode, country, state, city, latitude, longitude) on public.profiles to authenticated;

create or replace function public.is_streamwise_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_streamwise_admin() from public;
grant execute on function public.is_streamwise_admin() to anon, authenticated;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'General',
  website_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_ads (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  creative_url text not null check (creative_url ~* '^https?://'),
  storage_path text,
  creative_type text not null check (creative_type in ('image', 'video')),
  country text not null default 'India',
  state text,
  district text,
  city text,
  latitude double precision,
  longitude double precision,
  radius_km double precision not null default 50 check (radius_km > 0 and radius_km <= 5000),
  priority integer not null default 0 check (priority between 0 and 1000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index if not exists brand_ads_region_active_idx
  on public.brand_ads (country, state, city, active, priority desc);
create index if not exists brand_ads_brand_idx on public.brand_ads (brand_id);

alter table public.brands enable row level security;
alter table public.brand_ads enable row level security;
drop policy if exists "Public can read active brands" on public.brands;
create policy "Public can read active brands" on public.brands
  for select to anon, authenticated using (active or public.is_streamwise_admin());
drop policy if exists "Admins manage brands" on public.brands;
create policy "Admins manage brands" on public.brands
  for all to authenticated using (public.is_streamwise_admin()) with check (public.is_streamwise_admin());
drop policy if exists "Public can read active brand ads" on public.brand_ads;
create policy "Public can read active brand ads" on public.brand_ads
  for select to anon, authenticated
  using (active and exists (
    select 1 from public.brands b where b.id = brand_id and b.active
  ) or public.is_streamwise_admin());
drop policy if exists "Admins manage brand ads" on public.brand_ads;
create policy "Admins manage brand ads" on public.brand_ads
  for all to authenticated using (public.is_streamwise_admin()) with check (public.is_streamwise_admin());
grant select on public.brands, public.brand_ads to anon, authenticated;
grant insert, update, delete on public.brands, public.brand_ads to authenticated;

create table if not exists public.user_ad_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  brand_ad_id uuid not null references public.brand_ads(id) on delete cascade,
  location_hash text not null,
  output_url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, video_id, brand_ad_id, location_hash)
);

alter table public.user_ad_renders enable row level security;
drop policy if exists "Users can read their ad renders" on public.user_ad_renders;
create policy "Users can read their ad renders" on public.user_ad_renders
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can save their ad renders" on public.user_ad_renders;
create policy "Users can save their ad renders" on public.user_ad_renders
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users can delete their ad renders" on public.user_ad_renders;
create policy "Users can delete their ad renders" on public.user_ad_renders
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.user_ad_renders to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-creatives', 'brand-creatives', true, 104857600,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','video/x-matroska','video/x-msvideo'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view brand creatives" on storage.objects;
create policy "Public can view brand creatives" on storage.objects
  for select to anon, authenticated using (bucket_id = 'brand-creatives');
drop policy if exists "Admins upload brand creatives" on storage.objects;
create policy "Admins upload brand creatives" on storage.objects
  for insert to authenticated with check (bucket_id = 'brand-creatives' and public.is_streamwise_admin());
drop policy if exists "Admins update brand creatives" on storage.objects;
create policy "Admins update brand creatives" on storage.objects
  for update to authenticated using (bucket_id = 'brand-creatives' and public.is_streamwise_admin())
  with check (bucket_id = 'brand-creatives' and public.is_streamwise_admin());
drop policy if exists "Admins delete brand creatives" on storage.objects;
create policy "Admins delete brand creatives" on storage.objects
  for delete to authenticated using (bucket_id = 'brand-creatives' and public.is_streamwise_admin());
