-- StarShots multi-session delivery + canonical payment-proof linkage.
-- Apply after db-migration-part-14.sql. Safe to re-run.

alter table public.deliveries add column if not exists session_id text;

create index if not exists deliveries_event_key_session_id_idx
  on public.deliveries (event_key, session_id)
  where event_key is not null;
create index if not exists deliveries_session_id_idx
  on public.deliveries (session_id)
  where session_id is not null;

-- NULL session_id is intentional for legacy and booking-level vendor deliveries.
create or replace function public.confirm_pending_payment_proofs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate jsonb := null;
  candidates jsonb := '[]'::jsonb;
  payment_date_value date;
  payment_time_value time;
  payment_date_text text := '';
  payment_time_text text := '';
  payment_link text;
begin
  if new.status = 'deposit' and coalesce(new.paid_amount, 0) <= 0 then
    return new;
  end if;

  if jsonb_typeof(new.invoice_data -> 'payments') = 'array' then
    select coalesce(jsonb_agg(p), '[]'::jsonb) into candidates
    from jsonb_array_elements(new.invoice_data -> 'payments') p
    where lower(coalesce(p ->> 'status', '')) = 'confirmed'
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(old.invoice_data -> 'payments') = 'array'
            then old.invoice_data -> 'payments' else '[]'::jsonb end
        ) prev
        where coalesce(prev ->> 'id', '') = coalesce(p ->> 'id', '')
          and lower(coalesce(prev ->> 'status', '')) = 'confirmed'
          and coalesce(prev ->> 'amount', '') = coalesce(p ->> 'amount', '')
          and coalesce(prev ->> 'paidAtDate', '') = coalesce(p ->> 'paidAtDate', '')
          and coalesce(prev ->> 'paidAtTime', '') = coalesce(p ->> 'paidAtTime', '')
      );
    if jsonb_array_length(candidates) = 1 then
      candidate := candidates -> 0;
    elsif jsonb_array_length(candidates) = 0 then
      select coalesce(jsonb_agg(p), '[]'::jsonb) into candidates
      from jsonb_array_elements(new.invoice_data -> 'payments') p
      where lower(coalesce(p ->> 'status', '')) = 'confirmed';
      if jsonb_array_length(candidates) = 1 then candidate := candidates -> 0; end if;
    end if;
  elsif new.status = 'paid' then
    candidate := new.invoice_data -> 'paidReceipt';
    if candidate ->> 'paid' = 'false' then candidate := null; end if;
  elsif new.status = 'deposit' then
    select coalesce(jsonb_agg(p), '[]'::jsonb) into candidates
    from jsonb_array_elements(coalesce(new.invoice_data -> 'depositPayments', '[]'::jsonb)) p
    where p ->> 'paid' = 'true'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(old.invoice_data -> 'depositPayments', '[]'::jsonb)) prev
        where nullif(p ->> 'id', '') is not null
          and prev ->> 'id' = p ->> 'id'
          and prev ->> 'paid' = 'true'
          and coalesce(prev ->> 'paidAtDate', '') = coalesce(p ->> 'paidAtDate', '')
          and coalesce(prev ->> 'paidAtTime', '') = coalesce(p ->> 'paidAtTime', '')
          and coalesce(prev ->> 'amount', '') = coalesce(p ->> 'amount', '')
      );
    if jsonb_array_length(candidates) = 1 then candidate := candidates -> 0; end if;
  end if;

  payment_date_text := coalesce(candidate ->> 'paidAtDate', '');
  payment_time_text := coalesce(candidate ->> 'paidAtTime', '');
  payment_link := nullif(candidate ->> 'id', '');

  if payment_date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin payment_date_value := payment_date_text::date;
    exception when others then payment_date_value := null;
    end;
  end if;
  if payment_time_text ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    payment_time_value := payment_time_text::time;
  end if;

  update public.payment_proofs
  set status = 'confirmed',
      reviewed_at = now(),
      payment_date = coalesce(payment_date_value, payment_date),
      payment_time = case when payment_date_value is not null then payment_time_value else payment_time end,
      linked_payment_id = coalesce(payment_link, linked_payment_id)
  where invoice_id = new.id and status = 'pending';

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
