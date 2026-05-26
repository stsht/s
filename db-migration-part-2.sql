-- StarShots schema migration part 2/3: missing columns and triggers.
-- Run after part 1. Safe to run again.

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
