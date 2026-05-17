-- StarShots schema migration part 1/3: core tables.
-- Run parts 1, 2, 3 in order. Safe to run again.

create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  title text,
  name text not null,
  contact text,
  normalized_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_title text default 'Ms.',
  client_name text not null,
  client_contact text,
  invoice_date text,
  event_date text,
  event_time text,
  venue text,
  status text not null default 'invoice',
  grand_total bigint not null default 0,
  deposit_amount bigint not null default 0,
  paid_amount bigint not null default 0,
  balance_due bigint not null default 0,
  invoice_data jsonb not null default '{}'::jsonb,
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  title text default 'Ms.',
  client_name text not null,
  folder_name text not null,
  base_slug text not null,
  short_code text,
  password_hash text,
  password_salt text,
  client_id uuid,
  delivery_year integer,
  delivery_month integer,
  generated_text_whatsapp text,
  generated_text_instagram text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_links (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  service text not null,
  original_url text not null,
  slug text not null,
  short_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_access_logs (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references public.deliveries(id) on delete cascade,
  event_type text not null,
  service text,
  ip_address text,
  country text,
  city text,
  user_agent text,
  created_at timestamptz not null default now()
);
