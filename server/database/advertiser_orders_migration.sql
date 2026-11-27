-- Run after video_creator_review_migration.sql. Adds advertiser requests,
-- configurable INR pricing, manual payment records, and printable receipts.

begin;

create table if not exists public.advertiser_rate_cards (
  id text primary key default 'default' check (id = 'default'),
  currency text not null default 'INR' check (currency = 'INR'),
  issuer_name text not null default 'StreamWise AI',
  issuer_address text,
  issuer_tax_id text,
  base_fee_per_video numeric(12,2) not null default 0 check (base_fee_per_video >= 0),
  location_fee_per_video numeric(12,2) not null default 0 check (location_fee_per_video >= 0),
  radius_fee_per_10km numeric(12,2) not null default 0 check (radius_fee_per_10km >= 0),
  tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.advertiser_rate_cards (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.advertiser_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(id) on delete cascade,
  brand_name text not null check (char_length(brand_name) between 2 and 160),
  contact_name text not null check (char_length(contact_name) between 2 and 160),
  contact_email text not null,
  contact_phone text,
  website_url text,
  notes text,
  admin_note text,
  logo_url text not null,
  logo_storage_path text not null,
  country text not null,
  state text,
  district text,
  city text,
  latitude double precision,
  longitude double precision,
  radius_km double precision not null check (radius_km between 1 and 5000),
  status text not null default 'submitted'
    check (status in ('submitted','quoted','paid','processing','completed','partial','failed','rejected')),
  currency text not null default 'INR' check (currency = 'INR'),
  estimated_breakdown jsonb not null default '{}'::jsonb,
  quoted_breakdown jsonb,
  quoted_total numeric(12,2),
  payment_reference text,
  receipt_number text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.advertiser_request_videos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.advertiser_requests(id) on delete cascade,
  video_id uuid references public.videos(id) on delete set null,
  video_title text not null,
  creator_name text,
  status text not null default 'queued' check (status in ('queued','rendering','completed','failed')),
  ad_result_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, video_id)
);

create index if not exists advertiser_requests_owner_idx
  on public.advertiser_requests(owner_id, created_at desc);
create index if not exists advertiser_requests_status_idx
  on public.advertiser_requests(status, created_at);
create index if not exists advertiser_request_videos_request_idx
  on public.advertiser_request_videos(request_id, status);
create index if not exists advertiser_request_videos_video_idx
  on public.advertiser_request_videos(video_id);

alter table public.advertiser_rate_cards enable row level security;
alter table public.advertiser_requests enable row level security;
alter table public.advertiser_request_videos enable row level security;
revoke all privileges on public.advertiser_rate_cards, public.advertiser_requests, public.advertiser_request_videos
  from public, anon, authenticated;
grant select, insert, update, delete on public.advertiser_rate_cards, public.advertiser_requests, public.advertiser_request_videos
  to service_role;

commit;

notify pgrst, 'reload schema';
