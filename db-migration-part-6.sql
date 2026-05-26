-- StarShots schema migration part 6: event grouping keys.
-- Safe to run multiple times (idempotent). Run after parts 1-5.
--
-- Adds event_date + event_key to deliveries, and event_key to
-- invoices, so /db can group "Create Links" + "Create Invoice"
-- launched from the same client/event row into one event row,
-- regardless of which day each was created and regardless of
-- whether the date is TBA.
--
-- The worker writes both columns when the frontend supplies them
-- and falls back to a schema-tolerant insert that drops the
-- columns when they don't exist on a legacy schema, so this
-- migration is required for full grouping but not strictly
-- required to keep the existing flows working.

alter table public.deliveries add column if not exists event_date text;
alter table public.deliveries add column if not exists event_key  text;

alter table public.invoices   add column if not exists event_key  text;

create index if not exists deliveries_event_date_idx on public.deliveries(event_date);
create index if not exists deliveries_event_key_idx  on public.deliveries(event_key);
create index if not exists invoices_event_key_idx    on public.invoices(event_key);

notify pgrst, 'reload schema';
