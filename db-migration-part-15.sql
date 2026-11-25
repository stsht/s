-- Multi-session delivery and canonical payment-proof linkage.
-- Safe to run repeatedly. Apply after db-migration-part-14.sql.

alter table public.deliveries
  add column if not exists session_id text;

create index if not exists deliveries_event_key_session_id_idx
  on public.deliveries (event_key, session_id)
  where event_key is not null;

create index if not exists deliveries_session_id_idx
  on public.deliveries (session_id)
  where session_id is not null;

-- A NULL session_id is intentionally retained for legacy and vendor
-- deliveries, whose scope remains the whole booking.

create or replace function public.confirm_pending_payment_proofs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate jsonb := null;
  candidates jsonb := '[]'::jsonb;
  payment_date_text text := '';
  payment_time_text text := '';
  payment_date_value date;
  payment_time_value time;
  payment_link text;
begin
  if new.status = 'deposit' and coalesce(new.paid_amount, 0) <= 0 then
    return new;
  end if;

  -- Canonical ledger: link the proof to the single newly confirmed
  -- payment when that transition is unambiguous. Never rewrite the
  -- historical linked_payment_id on already-reviewed proofs.
  if jsonb_typeof(new.invoice_data -> 'payments') = 'array' then
    select coalesce(jsonb_agg(payment), '[]'::jsonb)
      into candidates
    from jsonb_array_elements(new.invoice_data -> 'payments') payment
    where lower(coalesce(payment ->> 'status', '')) = 'confirmed'
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(old.invoice_data -> 'payments') = 'array'
            then old.invoice_data -> 'payments' else '[]'::jsonb end
        ) previous
        where coalesce(previous ->> 'id', '') = coalesce(payment ->> 'id', '')
          and lower(coalesce(previous ->> 'status', '')) = 'confirmed'
          and coalesce(previous ->> 'amount', '') = coalesce(payment ->> 'amount', '')
          and coalesce(previous ->> 'paidAtDate', '') = coalesce(payment ->> 'paidAtDate', '')
          and coalesce(previous ->> 'paidAtTime', '') = coalesce(payment ->> 'paidAtTime', '')
      );

    if jsonb_array_length(candidates) = 1 then
      candidate := candidates -> 0;
    elsif jsonb_array_length(candidates) = 0 then
      select coalesce(jsonb_agg(payment), '[]'::jsonb)
        into candidates
      from jsonb_array_elements(new.invoice_data -> 'payments') payment
      where lower(coalesce(payment ->> 'status', '')) = 'confirmed';
      if jsonb_array_length(candidates) = 1 then
        candidate := candidates -> 0;
      end if;
    end if;
  elsif new.status = 'paid' then
    -- Legacy compatibility for invoices not yet normalized to payments[].
    candidate := coalesce(new.invoice_data -> 'paidReceipt', '{}'::jsonb);
    if candidate ->> 'paid' = 'false' then candidate := null; end if;
  elsif new.status = 'deposit' then
    select coalesce(jsonb_agg(payment), '[]'::jsonb)
      into candidates
    from jsonb_array_elements(coalesce(new.invoice_data -> 'depositPayments', '[]'::jsonb)) payment
    where payment ->> 'paid' = 'true'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(old.invoice_data -> 'depositPayments', '[]'::jsonb)) previous
        where nullif(payment ->> 'id', '') is not null
          and previous ->> 'id' = payment ->> 'id'
          and previous ->> 'paid' = 'true'
          and coalesce(previous ->> 'paidAtDate', '') = coalesce(payment ->> 'paidAtDate', '')
          and coalesce(previous ->> 'paidAtTime', '') = coalesce(payment ->> 'paidAtTime', '')
          and coalesce(previous ->> 'amount', '') = coalesce(payment ->> 'amount', '')
      );
    if jsonb_array_length(candidates) = 1 then candidate := candidates -> 0; end if;
  end if;

  if candidate is not null then
    payment_date_text := coalesce(candidate ->> 'paidAtDate', '');
    payment_time_text := coalesce(candidate ->> 'paidAtTime', '');
    payment_link := nullif(candidate ->> 'id', '');
  end if;

  if payment_date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      payment_date_value := payment_date_text::date;
    exception when others then
      payment_date_value := null;
    end;
  end if;
  if payment_time_text ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    payment_time_value := payment_time_text::time;
  end if;

  update public.payment_proofs
  set status = 'confirmed',
      reviewed_at = now(),
      payment_date = coalesce(payment_date_value, payment_date),
      payment_time = case
        when payment_date_value is not null then payment_time_value
        else payment_time
      end,
      linked_payment_id = coalesce(payment_link, linked_payment_id)
  where invoice_id = new.id
    and status = 'pending';

  return new;
end;
$$;

drop trigger if exists trg_confirm_pending_payment_proofs on public.invoices;
create trigger trg_confirm_pending_payment_proofs
after update of status, paid_amount, invoice_data on public.invoices
for each row
when (
  (new.status = 'paid' or (new.status = 'deposit' and coalesce(new.paid_amount, 0) > 0))
  and (
    old.status is distinct from new.status
    or old.paid_amount is distinct from new.paid_amount
    or old.invoice_data -> 'payments' is distinct from new.invoice_data -> 'payments'
    or old.invoice_data -> 'depositPayments' is distinct from new.invoice_data -> 'depositPayments'
    or old.invoice_data -> 'paidReceipt' is distinct from new.invoice_data -> 'paidReceipt'
  )
)
execute function public.confirm_pending_payment_proofs();

notify pgrst, 'reload schema';
