-- StarShots schema migration part 4: Subscriptions Table
-- Safe to run multiple times (idempotent).
-- Run after parts 1, 2, 3.
--
-- Why idempotent: a previous attempt failed because the database
-- already had a trigger named subscriptions_updated_at. This file
-- drops any existing trigger before recreating it, so re-running
-- the script will not raise a duplicate-trigger error.

create extension if not exists pgcrypto;

create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),

  -- ── Client ──────────────────────────────────────────────
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text not null,
  client_title    text not null default 'Ms.',
  client_contact  text,

  -- ── Service ─────────────────────────────────────────────
  service         text not null,
  storage_slot    text,
  access_period   integer not null default 30,
  bonus           integer not null default 0,
  rate_mode       text not null default 'normal',
  price           integer not null,
  manual_override boolean not null default false,

  -- ── Status & Timing ─────────────────────────────────────
  status          text not null default 'invoice',
  invoice_date    date not null default current_date,
  payment_date    date,
  payment_time    time,
  start_date      date,
  start_time      time,
  expiry_date     date,
  expiry_time     time,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Idempotent column adds for installs that already had an older table shape.
alter table public.subscriptions add column if not exists client_id       uuid references public.clients(id) on delete set null;
alter table public.subscriptions add column if not exists client_name     text;
alter table public.subscriptions add column if not exists client_title    text not null default 'Ms.';
alter table public.subscriptions add column if not exists client_contact  text;
alter table public.subscriptions add column if not exists service         text;
alter table public.subscriptions add column if not exists storage_slot    text;
alter table public.subscriptions add column if not exists access_period   integer not null default 30;
alter table public.subscriptions add column if not exists bonus           integer not null default 0;
alter table public.subscriptions add column if not exists rate_mode       text not null default 'normal';
alter table public.subscriptions add column if not exists price           integer not null default 0;
alter table public.subscriptions add column if not exists manual_override boolean not null default false;
alter table public.subscriptions add column if not exists status          text not null default 'invoice';
alter table public.subscriptions add column if not exists invoice_date    date not null default current_date;
alter table public.subscriptions add column if not exists payment_date    date;
alter table public.subscriptions add column if not exists payment_time    time;
alter table public.subscriptions add column if not exists start_date      date;
alter table public.subscriptions add column if not exists start_time      time;
alter table public.subscriptions add column if not exists expiry_date     date;
alter table public.subscriptions add column if not exists expiry_time     time;
alter table public.subscriptions add column if not exists created_at      timestamptz not null default now();
alter table public.subscriptions add column if not exists updated_at      timestamptz not null default now();

-- Safe indexes
create index if not exists subscriptions_client_id_idx   on public.subscriptions(client_id);
create index if not exists subscriptions_status_idx      on public.subscriptions(status);
create index if not exists subscriptions_created_at_idx  on public.subscriptions(created_at desc);
create index if not exists subscriptions_service_idx     on public.subscriptions(service);

-- Row Level Security (RLS) & Permissions
alter table public.subscriptions enable row level security;
grant select, insert, update, delete on public.subscriptions to service_role;

-- Helper trigger for automatic updated_at timestamp.
-- public.set_updated_at() is created by part 2; we recreate
-- public.set_current_timestamp_updated_at() here as an alias so
-- this file stays drop-in-runnable without depending on part 2.
create or replace function public.set_current_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Avoid 'trigger already exists' errors: drop the trigger first, then create it.
drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_current_timestamp_updated_at();

notify pgrst, 'reload schema';
