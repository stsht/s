-- StarShots schema migration part 11: per-period notes.
-- Safe to run multiple times (idempotent). Run after parts 1-10.
--
-- Adds an optional free-text `notes` column to both
-- public.subscriptions and public.subscription_extensions so each
-- period (the base subscription and every extension/renewal) can
-- carry its own short admin note alongside its payment proof.
--
-- The note belongs to the specific period, never to the customer
-- globally. The column is nullable and has no default, so existing
-- rows are untouched and remain valid. The worker also strips this
-- column automatically on writes if the schema cache predates this
-- migration, so applying it later never breaks saves.

alter table public.subscriptions
  add column if not exists notes text;

alter table public.subscription_extensions
  add column if not exists notes text;

notify pgrst, 'reload schema';
