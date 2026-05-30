-- StarShots schema migration part 5: Invoice Packages Table
-- Cloud-synced item/package catalogue powering the /inv autocomplete.
-- Safe to run multiple times (idempotent). Run after parts 1-4.
--
-- Stores both the 5 hardcoded defaults (is_default = true) and any
-- custom packages a user creates from the invoice generator. Defaults
-- start as seeded rows but remain editable/deletable in the app.

create extension if not exists pgcrypto;

create table if not exists public.invoice_packages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price      bigint not null default 0,
  note       text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent column adds in case an older table shape exists.
alter table public.invoice_packages add column if not exists name       text;
alter table public.invoice_packages add column if not exists price      bigint not null default 0;
alter table public.invoice_packages add column if not exists note       text not null default '';
alter table public.invoice_packages add column if not exists is_default boolean not null default false;
alter table public.invoice_packages add column if not exists created_at timestamptz not null default now();
alter table public.invoice_packages add column if not exists updated_at timestamptz not null default now();

-- Case-insensitive lookup index for the autocomplete name match.
create index if not exists idx_invoice_packages_name
  on public.invoice_packages (lower(name));

create index if not exists idx_invoice_packages_default_name
  on public.invoice_packages (is_default desc, name asc);

-- Row Level Security & service_role grants (mirrors part 4 pattern).
alter table public.invoice_packages enable row level security;
grant select, insert, update, delete on public.invoice_packages to service_role;

-- updated_at trigger. Reuse the helper created in part 4 (with a local
-- fallback so this file is drop-in runnable without depending on part 4).
create or replace function public.set_current_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists invoice_packages_updated_at on public.invoice_packages;
create trigger invoice_packages_updated_at
  before update on public.invoice_packages
  for each row
  execute function public.set_current_timestamp_updated_at();

-- Seed the 5 hardcoded defaults that have always shipped with the
-- invoice generator. Inserts are guarded by a unique-name check so
-- re-running the script does not produce duplicates.
insert into public.invoice_packages (name, price, note, is_default)
select v.name, v.price, v.note, true
from (values
  ('School without Magician', 800000::bigint,  'school celebration without magician'),
  ('School with Magician',    1000000::bigint, 'school celebration with magician'),
  ('Studio Special',          800000::bigint,  'up to 1 hour'),
  ('Intimate Party',          1300000::bigint, 'up to 2 hours, suitable for family celebration'),
  ('Birthday Celebration',    1650000::bigint, 'up to 3.5 hours, suitable for Birthday Celebration')
) as v(name, price, note)
where not exists (
  select 1 from public.invoice_packages p
  where lower(p.name) = lower(v.name)
);

-- Make sure existing rows that match the default names are flagged as default
-- (in case the table existed before this migration without the flag).
update public.invoice_packages
   set is_default = true
 where lower(name) in (
   'school without magician',
   'school with magician',
   'studio special',
   'intimate party',
   'birthday celebration'
 )
   and is_default = false;

notify pgrst, 'reload schema';
