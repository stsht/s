-- Persistent client-uploaded payment proof history.
-- Safe to run repeatedly.

create extension if not exists pgcrypto;

create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  delivery_id uuid references public.deliveries(id) on delete set null,
  client_id uuid,
  event_key text,
  event_date text,
  image_path text not null,
  original_filename text,
  mime_type text,
  status text not null default 'pending',
  reported_payment_date date,
  reported_payment_time time,
  reported_timezone_offset_minutes smallint,
  payment_date date,
  payment_time time,
  linked_payment_id text,
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  notes text
);

alter table public.payment_proofs add column if not exists reported_payment_date date;
alter table public.payment_proofs add column if not exists reported_payment_time time;
alter table public.payment_proofs add column if not exists reported_timezone_offset_minutes smallint;
alter table public.payment_proofs add column if not exists payment_date date;
alter table public.payment_proofs add column if not exists payment_time time;
alter table public.payment_proofs add column if not exists linked_payment_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_proofs_reported_timezone_offset_check'
      and conrelid = 'public.payment_proofs'::regclass
  ) then
    alter table public.payment_proofs
      add constraint payment_proofs_reported_timezone_offset_check
      check (
        reported_timezone_offset_minutes is null
        or reported_timezone_offset_minutes between -840 and 840
      );
  end if;
end;
$$;

create index if not exists payment_proofs_invoice_id_idx on public.payment_proofs(invoice_id);
create index if not exists payment_proofs_delivery_id_idx on public.payment_proofs(delivery_id);
create index if not exists payment_proofs_event_key_idx on public.payment_proofs(event_key);
create index if not exists payment_proofs_uploaded_at_idx on public.payment_proofs(uploaded_at desc);

alter table public.payment_proofs enable row level security;
grant select, insert, update, delete on public.payment_proofs to service_role;

create or replace function public.preserve_payment_proof_uploaded_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.uploaded_at := old.uploaded_at;
  return new;
end;
$$;

drop trigger if exists trg_preserve_payment_proof_uploaded_at on public.payment_proofs;
create trigger trg_preserve_payment_proof_uploaded_at
before update on public.payment_proofs
for each row
execute function public.preserve_payment_proof_uploaded_at();

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

-- Recording a deposit or final payment is the admin review action.
-- Confirm pending proofs only when payment status/amount actually changes,
-- so unrelated invoice edits never alter proof history.
create or replace function public.confirm_pending_payment_proofs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate jsonb;
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

  if new.status = 'paid' then
    candidate := coalesce(new.invoice_data -> 'paidReceipt', '{}'::jsonb);
    if candidate ->> 'paid' = 'false' then
      candidate := null;
    end if;
  elsif new.status = 'deposit' then
    select coalesce(jsonb_agg(payment), '[]'::jsonb)
    into candidates
    from jsonb_array_elements(coalesce(new.invoice_data -> 'depositPayments', '[]'::jsonb)) payment
    where payment ->> 'paid' = 'true'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(old.invoice_data -> 'depositPayments', '[]'::jsonb)) previous
        where nullif(payment ->> 'id', '') is not null
          and nullif(previous ->> 'id', '') = nullif(payment ->> 'id', '')
          and previous ->> 'paid' = 'true'
          and coalesce(previous ->> 'paidAtDate', '') = coalesce(payment ->> 'paidAtDate', '')
          and coalesce(previous ->> 'paidAtTime', '') = coalesce(payment ->> 'paidAtTime', '')
          and coalesce(previous ->> 'amount', '') = coalesce(payment ->> 'amount', '')
      );

    if jsonb_array_length(candidates) = 1 then
      candidate := candidates -> 0;
    elsif jsonb_array_length(candidates) = 0 then
      select coalesce(jsonb_agg(payment), '[]'::jsonb)
      into candidates
      from jsonb_array_elements(coalesce(new.invoice_data -> 'depositPayments', '[]'::jsonb)) payment
      where payment ->> 'paid' = 'true';
      if jsonb_array_length(candidates) = 1 then
        candidate := candidates -> 0;
      end if;
    end if;
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
    or old.invoice_data -> 'depositPayments' is distinct from new.invoice_data -> 'depositPayments'
    or old.invoice_data -> 'paidReceipt' is distinct from new.invoice_data -> 'paidReceipt'
  )
)
execute function public.confirm_pending_payment_proofs();

notify pgrst, 'reload schema';
