-- Adds district-level profile and campaign targeting.
-- Safe to run after personalized_ads_migration.sql and manual_auth_migration.sql.

begin;

alter table public.profiles
  add column if not exists district text;

alter table public.brand_ads
  add column if not exists district text;

create index if not exists brand_ads_region_district_active_idx
  on public.brand_ads (country, state, district, active, priority desc);

commit;

notify pgrst, 'reload schema';
