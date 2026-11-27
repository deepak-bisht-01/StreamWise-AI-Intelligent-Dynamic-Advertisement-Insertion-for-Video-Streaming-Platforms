-- Run after advertiser_orders_migration.sql.
-- Adds location-specific rate rules, admin-rated video tiers, and advertiser payment instructions.

begin;

alter table public.videos
  add column if not exists advertiser_priority_tier text not null default 'standard';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'videos_advertiser_priority_tier_check'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos add constraint videos_advertiser_priority_tier_check
      check (advertiser_priority_tier in ('standard', 'featured', 'premium'));
  end if;
end $$;

alter table public.advertiser_rate_cards
  add column if not exists location_rates jsonb not null default '[]'::jsonb,
  add column if not exists priority_multipliers jsonb not null default '{"standard":1,"featured":1.5,"premium":2}'::jsonb,
  add column if not exists payment_qr_url text not null default '/demo-payment-qr.svg',
  add column if not exists payment_instructions text not null default 'Scan the QR to pay, then submit the UTR or transaction reference for admin verification.';

alter table public.advertiser_requests
  add column if not exists advertiser_payment_reference text,
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists admin_quote_note text;

alter table public.advertiser_request_videos
  add column if not exists video_priority_tier text not null default 'standard';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'advertiser_request_videos_priority_tier_check'
      and conrelid = 'public.advertiser_request_videos'::regclass
  ) then
    alter table public.advertiser_request_videos add constraint advertiser_request_videos_priority_tier_check
      check (video_priority_tier in ('standard', 'featured', 'premium'));
  end if;
end $$;

update public.advertiser_rate_cards
set payment_qr_url = '/demo-payment-qr.svg'
where payment_qr_url is null or btrim(payment_qr_url) = '';

commit;

notify pgrst, 'reload schema';
