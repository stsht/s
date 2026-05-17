-- StarShots schema migration part 3/3: indexes, RLS, grants.
-- Run after part 2. Safe to run again.

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
