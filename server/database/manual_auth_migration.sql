-- Run the entire file in the Supabase SQL Editor after
-- personalized_ads_migration.sql, using the project configured in server/.env.
-- This moves account authentication
-- from Supabase Auth to the StreamWise API.
-- Existing Supabase Auth accounts are not copied: their passwords cannot be
-- reused by this password-hash format. Existing profile rows and campaigns
-- remain in place; new StreamWise accounts get new IDs.

begin;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists app_users_email_lower_key
  on public.app_users (lower(email));

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Repair defaults too, since CREATE TABLE IF NOT EXISTS does not update an
-- app_users/app_sessions table created by an earlier partial setup.
alter table public.app_users
  alter column id set default gen_random_uuid(),
  alter column created_at set default now();
alter table public.app_sessions
  alter column id set default gen_random_uuid(),
  alter column created_at set default now();

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions(expires_at);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
revoke all on public.app_users, public.app_sessions from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.app_users, public.app_sessions to service_role;
grant select, insert, update, delete
  on public.profiles, public.brands, public.brand_ads, public.user_ad_renders
  to service_role;

-- Supabase Auth no longer creates application profiles.
drop trigger if exists on_auth_user_created_profile on auth.users;
drop function if exists public.handle_new_auth_user();

-- Preserve existing profile and render rows while enforcing the new relationship
-- for new rows. NOT VALID leaves legacy Supabase Auth IDs intact.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles drop constraint if exists profiles_id_app_users_fkey;
alter table public.profiles
  add constraint profiles_id_app_users_fkey
  foreign key (id) references public.app_users(id) on delete cascade not valid;

alter table public.brand_ads drop constraint if exists brand_ads_created_by_fkey;
alter table public.brand_ads drop constraint if exists brand_ads_created_by_app_users_fkey;
alter table public.brand_ads
  add constraint brand_ads_created_by_app_users_fkey
  foreign key (created_by) references public.app_users(id) on delete set null not valid;

alter table public.user_ad_renders drop constraint if exists user_ad_renders_user_id_fkey;
alter table public.user_ad_renders drop constraint if exists user_ad_renders_user_id_app_users_fkey;
alter table public.user_ad_renders
  add constraint user_ad_renders_user_id_app_users_fkey
  foreign key (user_id) references public.app_users(id) on delete cascade not valid;

commit;

notify pgrst, 'reload schema';
