-- StarShots schema migration part 8: delivery "done" flag.
-- Safe to run multiple times (idempotent). Run after parts 1-7.
--
-- Adds a boolean `delivery_done` flag to public.deliveries so a
-- delivery row can be marked as completed/handed-off independently
-- of its links or paired invoice. Defaults to false so every
-- existing row reads as "not done" until the operator flips it.
--
-- The supporting index keeps "list / count deliveries by done
-- state" cheap if the dashboard ever filters or sorts on it.

alter table public.deliveries
  add column if not exists delivery_done boolean not null default false;

create index if not exists deliveries_delivery_done_idx
  on public.deliveries (delivery_done);

notify pgrst, 'reload schema';
