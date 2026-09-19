-- Additive: preserve all existing products, memberships and price observations.
alter table public.price_observations add column if not exists client_event_id uuid;
alter table public.price_observations add column if not exists recorded_by uuid references auth.users(id) on delete set null;
alter table public.price_observations add column if not exists capture_metadata jsonb;
create unique index if not exists price_observations_client_event_unique on public.price_observations(store_id,client_event_id) where client_event_id is not null;
create index if not exists price_observations_recorded_by_idx on public.price_observations(recorded_by);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('capture-evidence','capture-evidence',false,10485760,array['image/jpeg'])
on conflict (id) do nothing;
create policy capture_evidence_member_read on storage.objects for select to authenticated
using (bucket_id='capture-evidence' and exists (select 1 from public.memberships m where m.store_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
create policy capture_evidence_editor_insert on storage.objects for insert to authenticated
with check (bucket_id='capture-evidence' and (storage.foldername(name))[2]=(select auth.uid())::text and exists (select 1 from public.memberships m where m.store_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor')));

create or replace function public.commit_capture_price(p_id uuid,p_store uuid,p_product uuid,p_cents integer,p_unit text,p_observed_at timestamptz,p_evidence text,p_metadata jsonb)
returns uuid language plpgsql security invoker set search_path=public,storage,pg_temp as $$
declare v_product public.products%rowtype; v_prior public.price_observations%rowtype; v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.memberships where store_id=p_store and user_id=auth.uid() and role in ('owner','admin','editor')) then raise exception 'Capture write is not authorized' using errcode='42501'; end if;
  if p_id is null or p_cents is null or p_cents<0 or p_cents>999999999 then raise exception 'Invalid operation or price'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or p_metadata->>'reviewed' is distinct from 'true' or octet_length(p_metadata::text)>65536 then raise exception 'Explicit human review and bounded metadata required'; end if;
  if p_observed_at is null or p_observed_at>now()+interval '5 minutes' or p_observed_at<now()-interval '1 year' then raise exception 'Invalid capture timestamp. Check device clock.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_id::text,0));
  select * into v_prior from public.price_observations where store_id=p_store and client_event_id=p_id;
  if found then
    if v_prior.product_id is distinct from p_product or v_prior.observed_price is distinct from p_cents/100.0 or v_prior.capture_metadata is distinct from p_metadata or v_prior.observed_at is distinct from p_observed_at or v_prior.recorded_by is distinct from auth.uid() or v_prior.source_ref is distinct from coalesce(p_evidence,'capture:'||p_id::text) then raise exception 'Operation ID reused with different content'; end if;
    return v_prior.id;
  end if;
  select * into v_product from public.products where id=p_product and store_id=p_store and active=true for share;
  if not found then raise exception 'Product no longer available in this store'; end if;
  if nullif(p_unit,'') is null or v_product.unit is distinct from p_unit then raise exception 'Unit changed or missing. Review the product before saving.'; end if;
  if p_evidence is not null then
    if p_evidence<>p_store::text||'/'||auth.uid()::text||'/'||p_id::text||'.jpg' or not exists(select 1 from storage.objects where bucket_id='capture-evidence' and name=p_evidence) then raise exception 'Private image evidence is missing or invalid'; end if;
  end if;
  insert into public.price_observations(store_id,product_id,internal_code,observed_price,observed_at,source_type,source_ref,barcode,confidence,verified,note,client_event_id,recorded_by,capture_metadata)
  values(p_store,p_product,v_product.internal_code,p_cents/100.0,p_observed_at,case when p_evidence is null then 'manual' else 'shelf_photo' end,coalesce(p_evidence,'capture:'||p_id::text),v_product.barcode,null,true,'Human-reviewed capture; model scores are not calibrated probabilities.',p_id,auth.uid(),p_metadata) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.commit_capture_price(uuid,uuid,uuid,integer,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.commit_capture_price(uuid,uuid,uuid,integer,text,timestamptz,text,jsonb) to authenticated;
