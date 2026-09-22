-- Leaksy expiry tracking: physical batches, monitoring thresholds and idempotent reviewed capture.
create table if not exists public.expiry_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  critical_days integer not null default 7 check (critical_days >= 0),
  warning_days integer not null default 30 check (warning_days >= critical_days),
  monitor_days integer not null default 90 check (monitor_days >= warning_days),
  updated_at timestamptz not null default now()
);

insert into public.expiry_settings(store_id)
select id from public.stores
on conflict (store_id) do nothing;

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  lot_number text,
  expiry_date date not null,
  expiry_kind text not null default 'expiry'
    check (expiry_kind in ('expiry','best_before','sell_by','unknown')),
  quantity numeric(14,3) check (quantity is null or quantity >= 0),
  source_type text not null
    check (source_type in ('gs1','ocr','manual','galaxy')),
  source_ref text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  capture_metadata jsonb not null default '{}'::jsonb,
  client_event_id uuid,
  captured_by uuid references auth.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_batches_client_event_unique
  on public.product_batches(store_id, client_event_id)
  where client_event_id is not null;
create index if not exists product_batches_product_expiry_idx
  on public.product_batches(product_id, expiry_date);
create index if not exists product_batches_store_expiry_idx
  on public.product_batches(store_id, expiry_date);
create index if not exists product_batches_location_idx
  on public.product_batches(location_id)
  where location_id is not null;

alter table public.expiry_settings enable row level security;
alter table public.product_batches enable row level security;

drop policy if exists expiry_settings_member_select on public.expiry_settings;
create policy expiry_settings_member_select
on public.expiry_settings for select to authenticated
using (exists (
  select 1 from public.memberships m
  where m.store_id = expiry_settings.store_id
    and m.user_id = (select auth.uid())
));

drop policy if exists expiry_settings_admin_write on public.expiry_settings;
create policy expiry_settings_admin_write
on public.expiry_settings for all to authenticated
using (exists (
  select 1 from public.memberships m
  where m.store_id = expiry_settings.store_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from public.memberships m
  where m.store_id = expiry_settings.store_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));

drop policy if exists product_batches_member_select on public.product_batches;
create policy product_batches_member_select
on public.product_batches for select to authenticated
using (exists (
  select 1 from public.memberships m
  where m.store_id = product_batches.store_id
    and m.user_id = (select auth.uid())
));

drop policy if exists product_batches_editor_write on public.product_batches;
create policy product_batches_editor_write
on public.product_batches for all to authenticated
using (exists (
  select 1 from public.memberships m
  where m.store_id = product_batches.store_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin','editor')
))
with check (exists (
  select 1 from public.memberships m
  where m.store_id = product_batches.store_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin','editor')
));

grant select on public.expiry_settings, public.product_batches to authenticated;
grant insert, update, delete on public.expiry_settings, public.product_batches to authenticated;

create or replace function public.commit_expiry_batch(
  p_id uuid,
  p_store uuid,
  p_product uuid,
  p_expiry date,
  p_kind text,
  p_lot text,
  p_quantity numeric,
  p_location uuid,
  p_source_type text,
  p_source_ref text,
  p_confidence numeric,
  p_metadata jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prior public.product_batches%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.memberships
    where store_id = p_store and user_id = auth.uid()
      and role in ('owner','admin','editor')
  ) then
    raise exception 'Expiry capture write is not authorized' using errcode='42501';
  end if;
  if p_id is null or p_product is null or p_expiry is null then
    raise exception 'Missing expiry capture identifiers';
  end if;
  if p_kind not in ('expiry','best_before','sell_by','unknown') then
    raise exception 'Unsupported expiry kind';
  end if;
  if p_source_type not in ('gs1','ocr','manual','galaxy') then
    raise exception 'Unsupported expiry source';
  end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity > 1000000) then
    raise exception 'Invalid quantity';
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'Invalid confidence';
  end if;
  if p_expiry < current_date - interval '1 year'
     or p_expiry > current_date + interval '15 years' then
    raise exception 'Expiry date outside accepted range';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or p_metadata->>'reviewed' is distinct from 'true'
     or octet_length(p_metadata::text) > 65536 then
    raise exception 'Explicit human review and bounded metadata required';
  end if;

  perform 1 from public.products
   where id = p_product and store_id = p_store and active = true;
  if not found then raise exception 'Product no longer available in this store'; end if;

  if p_location is not null then
    perform 1 from public.locations where id = p_location and store_id = p_store;
    if not found then raise exception 'Location does not belong to this store'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store::text || p_id::text, 0));

  select * into v_prior from public.product_batches
  where store_id = p_store and client_event_id = p_id;

  if found then
    if v_prior.product_id is distinct from p_product
       or v_prior.expiry_date is distinct from p_expiry
       or v_prior.expiry_kind is distinct from p_kind
       or v_prior.lot_number is distinct from nullif(trim(p_lot),'')
       or v_prior.quantity is distinct from p_quantity
       or v_prior.location_id is distinct from p_location
       or v_prior.source_type is distinct from p_source_type
       or v_prior.source_ref is distinct from p_source_ref
       or v_prior.confidence is distinct from p_confidence
       or v_prior.capture_metadata is distinct from p_metadata then
      raise exception 'Operation ID reused with different expiry content';
    end if;
    return v_prior.id;
  end if;

  insert into public.product_batches(
    store_id, product_id, location_id, lot_number, expiry_date, expiry_kind,
    quantity, source_type, source_ref, confidence, capture_metadata,
    client_event_id, captured_by
  )
  values(
    p_store, p_product, p_location, nullif(trim(p_lot),''), p_expiry, p_kind,
    p_quantity, p_source_type, p_source_ref, p_confidence, p_metadata,
    p_id, auth.uid()
  )
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.commit_expiry_batch(
  uuid,uuid,uuid,date,text,text,numeric,uuid,text,text,numeric,jsonb
) from public, anon;
grant execute on function public.commit_expiry_batch(
  uuid,uuid,uuid,date,text,text,numeric,uuid,text,text,numeric,jsonb
) to authenticated;

create or replace view public.expiry_batches_overview
with (security_invoker = true)
as
select
  b.id as batch_id, b.store_id, b.product_id, p.internal_code, p.barcode,
  p.description, p.unit, b.location_id, l.code as location_code, b.lot_number,
  b.expiry_date, b.expiry_kind, b.quantity, b.source_type, b.source_ref,
  b.confidence, b.captured_at, (b.expiry_date - current_date) as days_until_expiry,
  case
    when b.expiry_date < current_date then 'expired'
    when b.expiry_date <= current_date + make_interval(days => coalesce(s.critical_days,7)) then 'critical'
    when b.expiry_date <= current_date + make_interval(days => coalesce(s.warning_days,30)) then 'warning'
    when b.expiry_date <= current_date + make_interval(days => coalesce(s.monitor_days,90)) then 'monitor'
    else 'ok'
  end as expiry_status
from public.product_batches b
join public.products p on p.id = b.product_id
left join public.locations l on l.id = b.location_id
left join public.expiry_settings s on s.store_id = b.store_id;

grant select on public.expiry_batches_overview to authenticated;

create or replace view public.product_overview
with (security_invoker = true)
as
select
  p.id as product_id, p.store_id, p.internal_code, p.barcode, p.description,
  p.unit, p.catalog_price, po.observed_price as shelf_price,
  case when po.observed_price is null or p.catalog_price is null then null::numeric
       else round(po.observed_price - p.catalog_price, 2) end as price_diff,
  case when po.observed_price is null then 'unchecked'::text
       when p.catalog_price is null then 'review'::text
       when po.observed_price = p.catalog_price then 'same'::text
       else 'different'::text end as price_status,
  po.source_ref, po.observed_at, l.code as location_code, pl.row_label, pl.number_label,
  ex.nearest_expiry, ex.expiry_batch_count, ex.expiry_quantity,
  case
    when ex.nearest_expiry is null then 'untracked'
    when ex.nearest_expiry < current_date then 'expired'
    when ex.nearest_expiry <= current_date + make_interval(days => coalesce(es.critical_days,7)) then 'critical'
    when ex.nearest_expiry <= current_date + make_interval(days => coalesce(es.warning_days,30)) then 'warning'
    when ex.nearest_expiry <= current_date + make_interval(days => coalesce(es.monitor_days,90)) then 'monitor'
    else 'ok'
  end as expiry_status,
  case when ex.nearest_expiry is null then null else ex.nearest_expiry - current_date end as days_until_expiry
from public.products p
left join lateral (
  select x.observed_price, x.source_ref, x.observed_at
  from public.price_observations x
  where x.product_id = p.id
  order by x.observed_at desc, x.created_at desc
  limit 1
) po on true
left join public.product_locations pl on pl.product_id = p.id and pl.is_current = true
left join public.locations l on l.id = pl.location_id
left join lateral (
  select min(b.expiry_date) as nearest_expiry,
         count(*)::integer as expiry_batch_count,
         sum(coalesce(b.quantity,0)) as expiry_quantity
  from public.product_batches b
  where b.product_id = p.id
) ex on true
left join public.expiry_settings es on es.store_id = p.store_id;

grant select on public.product_overview to authenticated;
