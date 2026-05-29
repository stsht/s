-- StarShots schema migration part 7: subscription extensions.
-- Safe to run multiple times (idempotent). Run after parts 1-6.
--
-- Adds the public.subscription_extensions table that lets a single
-- subscription accumulate a history of renewals/extensions without
-- spawning new subscription rows. The latest extension's expiry/
-- status drives the visible "active" state in the Subs list; the
-- base subscription row keeps its original Payment/Start/Expiry as
-- the receipt of record.
--
-- This is the Subs-side analogue of how Events under Clients are
-- derived from invoices+deliveries — but kept entirely separate
-- from the Clients data model so a Subs renewal never touches the
-- public.clients table.

create extension if not exists pgcrypto;

create table if not exists public.subscription_extensions (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,

  -- Extension shape mirrors the editable subset of a subscription.
  -- service is optional: an extension defaults to the parent's
  -- service when blank, and is only stored explicitly when the
  -- operator changed services on renewal.
  service         text,
  status          text not null default 'paid',
  access_period   integer not null default 30,
  bonus           integer not null default 0,
  price           integer not null default 0,

  -- Date/time pairs follow the same shape as subscriptions so the
  -- frontend can reuse the same input controls and formatters.
  start_date      date,
  start_time      time,
  expiry_date     date,
  expiry_time     time,

  -- Payment date/time for this renewal. The base subscription keeps
  -- its own (Initial) payment date untouched; each extension records
  -- the payment that funded it so a new extension can default its
  -- Payment Date to the latest payment in the chain.
  payment_date    date,
  payment_time    time,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Idempotent column adds for installs that already had an older
-- table shape from an earlier draft of this migration.
alter table public.subscription_extensions add column if not exists subscription_id uuid;
alter table public.subscription_extensions add column if not exists service       text;
alter table public.subscription_extensions add column if not exists status        text not null default 'paid';
alter table public.subscription_extensions add column if not exists access_period integer not null default 30;
alter table public.subscription_extensions add column if not exists bonus         integer not null default 0;
alter table public.subscription_extensions add column if not exists price         integer not null default 0;
alter table public.subscription_extensions add column if not exists start_date    date;
alter table public.subscription_extensions add column if not exists start_time    time;
alter table public.subscription_extensions add column if not exists expiry_date   date;
alter table public.subscription_extensions add column if not exists expiry_time   time;
alter table public.subscription_extensions add column if not exists payment_date  date;
alter table public.subscription_extensions add column if not exists payment_time  time;
alter table public.subscription_extensions add column if not exists created_at    timestamptz not null default now();
alter table public.subscription_extensions add column if not exists updated_at    timestamptz not null default now();

-- Indexes for the two common access patterns: list extensions for
-- one subscription (already ordered by recency), and find the
-- latest extension across all subscriptions in a single fetch.
create index if not exists subscription_extensions_subscription_id_idx
  on public.subscription_extensions(subscription_id);
create index if not exists subscription_extensions_expiry_date_idx
  on public.subscription_extensions(expiry_date desc);
create index if not exists subscription_extensions_created_at_idx
  on public.subscription_extensions(created_at desc);

-- Row Level Security & Permissions — same posture as subscriptions.
alter table public.subscription_extensions enable row level security;
grant select, insert, update, delete on public.subscription_extensions to service_role;

-- Reuse the shared updated_at trigger function from part 2/4 so
-- mutations bump updated_at automatically.
drop trigger if exists subscription_extensions_updated_at on public.subscription_extensions;
create trigger subscription_extensions_updated_at
  before update on public.subscription_extensions
  for each row
  execute function public.set_current_timestamp_updated_at();

notify pgrst, 'reload schema';
