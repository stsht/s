-- StarShots schema migration part 10: per-period payment proof.
-- Safe to run multiple times (idempotent). Run after parts 1-9.
--
-- Adds an optional `payment_proof` text column to both
-- public.subscriptions and public.subscription_extensions so each
-- period (the base subscription and every extension/renewal) can
-- carry its own payment proof — typically a URL to a receipt image
-- or a short reference string.
--
-- The proof belongs to the specific period being paid, never to the
-- customer globally. The column is nullable and has no default, so
-- existing rows are untouched and remain valid. The worker also
-- strips this column automatically on writes if the schema cache
-- predates this migration, so applying it later never breaks saves.

alter table public.subscriptions
  add column if not exists payment_proof text;

alter table public.subscription_extensions
  add column if not exists payment_proof text;

notify pgrst, 'reload schema';
