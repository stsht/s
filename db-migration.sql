-- StarShots unified schema migration.
-- Safe to run again. Replace your old snippets with this single file.

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

alter table public.clients add column if not exists title text;
alter table public.clients add column if not exists name text;
alter table public.clients add column if not exists contact text;
alter table public.clients add column if not exists normalized_name text;
alter table public.clients add column if not exists created_at timestamptz not null default now();
alter table public.clients add column if not exists updated_at timestamptz not null default now();

alter table public.invoices add column if not exists client_title text default 'Ms.';
alter table public.invoices add column if not exists client_name text;
alter table public.invoices add column if not exists client_contact text;
alter table public.invoices add column if not exists invoice_date text;
alter table public.invoices add column if not exists event_date text;
alter table public.invoices add column if not exists event_time text;
alter table public.invoices add column if not exists venue text;
alter table public.invoices add column if not exists status text default 'invoice';
alter table public.invoices add column if not exists grand_total bigint not null default 0;
alter table public.invoices add column if not exists deposit_amount bigint not null default 0;
alter table public.invoices add column if not exists paid_amount bigint not null default 0;
alter table public.invoices add column if not exists balance_due bigint not null default 0;
alter table public.invoices add column if not exists invoice_data jsonb not null default '{}'::jsonb;
alter table public.invoices add column if not exists client_id uuid;
alter table public.invoices add column if not exists created_at timestamptz not null default now();
alter table public.invoices add column if not exists updated_at timestamptz not null default now();

alter table public.deliveries add column if not exists title text default 'Ms.';
alter table public.deliveries add column if not exists client_name text;
alter table public.deliveries add column if not exists folder_name text;
alter table public.deliveries add column if not exists base_slug text;
alter table public.deliveries add column if not exists short_code text;
alter table public.deliveries add column if not exists password_hash text;
alter table public.deliveries add column if not exists password_salt text;
alter table public.deliveries add column if not exists client_id uuid;
alter table public.deliveries add column if not exists delivery_year integer;
alter table public.deliveries add column if not exists delivery_month integer;
alter table public.deliveries add column if not exists generated_text_whatsapp text;
alter table public.deliveries add column if not exists generated_text_instagram text;
alter table public.deliveries add column if not exists event_date text;
alter table public.deliveries add column if not exists event_key  text;
alter table public.deliveries add column if not exists created_at timestamptz not null default now();
alter table public.deliveries add column if not exists updated_at timestamptz not null default now();

alter table public.invoices   add column if not exists event_key  text;

alter table public.delivery_links add column if not exists delivery_id uuid;
alter table public.delivery_links add column if not exists service text;
alter table public.delivery_links add column if not exists original_url text;
alter table public.delivery_links add column if not exists slug text;
alter table public.delivery_links add column if not exists short_path text;
alter table public.delivery_links add column if not exists created_at timestamptz not null default now();

alter table public.delivery_access_logs add column if not exists delivery_id uuid;
alter table public.delivery_access_logs add column if not exists event_type text;
alter table public.delivery_access_logs add column if not exists service text;
alter table public.delivery_access_logs add column if not exists ip_address text;
alter table public.delivery_access_logs add column if not exists country text;
alter table public.delivery_access_logs add column if not exists city text;
alter table public.delivery_access_logs add column if not exists user_agent text;
alter table public.delivery_access_logs add column if not exists created_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_deliveries_updated_at on public.deliveries;
create trigger trg_deliveries_updated_at
before update on public.deliveries
for each row execute function public.set_updated_at();

create unique index if not exists deliveries_short_code_uidx
  on public.deliveries(short_code)
  where short_code is not null and short_code <> '';

create index if not exists clients_normalized_name_idx
  on public.clients(normalized_name);

create index if not exists invoices_client_id_idx
  on public.invoices(client_id);

create index if not exists invoices_status_idx
  on public.invoices(status);

create index if not exists invoices_created_at_idx
  on public.invoices(created_at desc);

create index if not exists deliveries_client_id_idx
  on public.deliveries(client_id);

create index if not exists deliveries_base_slug_idx
  on public.deliveries(base_slug);

create index if not exists deliveries_created_at_idx
  on public.deliveries(created_at desc);

create index if not exists delivery_links_delivery_id_idx
  on public.delivery_links(delivery_id);

create unique index if not exists delivery_links_service_slug_uidx
  on public.delivery_links(service, slug)
  where slug is not null;

create index if not exists delivery_access_logs_delivery_id_idx
  on public.delivery_access_logs(delivery_id);

create index if not exists delivery_access_logs_created_at_idx
  on public.delivery_access_logs(created_at);

alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_links enable row level security;
alter table public.delivery_access_logs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
grant usage, select on sequences to service_role;

notify pgrst, 'reload schema';


-- ── Subscription extensions (mirrors db-migration-part-7.sql) ──────
-- Subs-side renewal/extension history. Each row is a renewal event
-- on an existing subscription; the latest extension's expiry/status
-- drives the visible "active" state in the /db Subs list.

create table if not exists public.subscription_extensions (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  service         text,
  status          text not null default 'paid',
  access_period   integer not null default 30,
  bonus           integer not null default 0,
  price           integer not null default 0,
  start_date      date,
  start_time      time,
  expiry_date     date,
  expiry_time     time,
  payment_date    date,
  payment_time    time,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

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

create index if not exists subscription_extensions_subscription_id_idx
  on public.subscription_extensions(subscription_id);
create index if not exists subscription_extensions_expiry_date_idx
  on public.subscription_extensions(expiry_date desc);
create index if not exists subscription_extensions_created_at_idx
  on public.subscription_extensions(created_at desc);

alter table public.subscription_extensions enable row level security;
grant select, insert, update, delete on public.subscription_extensions to service_role;

drop trigger if exists subscription_extensions_updated_at on public.subscription_extensions;
create trigger subscription_extensions_updated_at
  before update on public.subscription_extensions
  for each row
  execute function public.set_current_timestamp_updated_at();

notify pgrst, 'reload schema';


-- ── Delivery "done" flag (mirrors db-migration-part-8.sql) ─────────
-- Marks a delivery row as completed/handed-off independently of its
-- links or paired invoice. Defaults to false; the index keeps
-- filtering/counting by done-state cheap.

alter table public.deliveries
  add column if not exists delivery_done boolean not null default false;

create index if not exists deliveries_delivery_done_idx
  on public.deliveries (delivery_done);

notify pgrst, 'reload schema';


-- ── Delivery Link "done" flag (mirrors db-migration-part-9.sql) ─────
-- Adds a boolean `link_done` flag to public.delivery_links so a
-- service URL can be marked as completed/done independently.
-- Defaults to false.

alter table public.delivery_links
  add column if not exists link_done boolean not null default false;

create index if not exists delivery_links_link_done_idx
  on public.delivery_links (link_done);

notify pgrst, 'reload schema';

-- ── Password History ─────────
-- Adds a jsonb array to track old passwords when rotated.
alter table public.deliveries
  add column if not exists password_history jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
