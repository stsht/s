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
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  notes text
);

create index if not exists payment_proofs_invoice_id_idx on public.payment_proofs(invoice_id);
create index if not exists payment_proofs_delivery_id_idx on public.payment_proofs(delivery_id);
create index if not exists payment_proofs_event_key_idx on public.payment_proofs(event_key);
create index if not exists payment_proofs_uploaded_at_idx on public.payment_proofs(uploaded_at desc);

alter table public.payment_proofs enable row level security;
grant select, insert, update, delete on public.payment_proofs to service_role;

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

notify pgrst, 'reload schema';
