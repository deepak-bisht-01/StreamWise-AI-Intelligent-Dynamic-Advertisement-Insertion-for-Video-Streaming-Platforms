-- Run after ad_analysis_migration.sql and manual_auth_migration.sql. This
-- stores upload attribution and makes AI/ad review an explicit admin decision.

begin;

alter table public.videos
  add column if not exists uploaded_by uuid,
  add column if not exists creator_name text not null default 'Legacy creator',
  add column if not exists ad_review_enabled boolean not null default false;

-- Preserve existing admin-reviewed analyses and rendered ads as selected.
update public.videos
set ad_review_enabled = true
where analysis_status in ('processing', 'completed', 'no_slots', 'failed')
   or case when jsonb_typeof(analysis_meta -> 'adResults') = 'array'
      then jsonb_array_length(analysis_meta -> 'adResults') > 0
      else false end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'videos_uploaded_by_app_users_fkey'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos
      add constraint videos_uploaded_by_app_users_fkey
      foreign key (uploaded_by) references public.app_users(id)
      on delete set null not valid;
  end if;
end $$;

create index if not exists videos_uploaded_by_idx on public.videos(uploaded_by);
create index if not exists videos_ad_review_enabled_idx on public.videos(ad_review_enabled, created_at desc);

commit;

notify pgrst, 'reload schema';
