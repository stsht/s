-- StarShots migration part 14: decommission legacy Subscriptions.
-- Run after deploying the application code that no longer references Subs.
-- This DROP is destructive to any rows still present in these two tables.
-- Take a database backup first if any historical Subs data must be retained.
-- Optional read-only preflight:
--   SELECT 'subscriptions' AS table_name, COUNT(*) FROM public.subscriptions
--   UNION ALL
--   SELECT 'subscription_extensions', COUNT(*) FROM public.subscription_extensions;
-- This migration drops only the Subs-owned tables. Historical migration
-- files (parts 4, 7, 10, and 11) remain in Git as an audit trail and
-- should not be re-applied after this migration.
--
-- Deliberately preserved:
--   public.clients, public.invoices, public.deliveries
--   public.payment_proofs and the private payment-proofs Storage bucket
--   public.invoice_packages and shared timestamp trigger helper
--
-- The shared public.set_current_timestamp_updated_at() function is
-- intentionally retained because invoice_packages also uses it.

DROP TABLE IF EXISTS public.subscription_extensions;
DROP TABLE IF EXISTS public.subscriptions;

NOTIFY pgrst, 'reload schema';
