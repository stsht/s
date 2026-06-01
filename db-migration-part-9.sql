-- StarShots schema migration part 9: delivery link "done" flag.
-- Safe to run multiple times (idempotent). Run after parts 1-8.
--
-- Adds a boolean `link_done` flag to public.delivery_links so a
-- service URL can be marked as completed/done independently.
-- Defaults to false.
--
-- The supporting index keeps querying/filtering quick.

alter table public.delivery_links
  add column if not exists link_done boolean not null default false;

create index if not exists delivery_links_link_done_idx
  on public.delivery_links (link_done);

notify pgrst, 'reload schema';
