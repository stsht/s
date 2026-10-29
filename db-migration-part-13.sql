-- Ensure payment proof payment-time columns exist and refresh PostgREST schema cache.
-- Safe to run repeatedly.

ALTER TABLE public.payment_proofs
  ADD COLUMN IF NOT EXISTS reported_payment_date date,
  ADD COLUMN IF NOT EXISTS reported_payment_time time,
  ADD COLUMN IF NOT EXISTS reported_timezone_offset_minutes smallint,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_time time,
  ADD COLUMN IF NOT EXISTS linked_payment_id text;

NOTIFY pgrst, 'reload schema';
