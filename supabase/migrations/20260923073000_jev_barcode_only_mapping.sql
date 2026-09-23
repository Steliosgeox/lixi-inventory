-- Barcode-only commits let a verified Jev identity enrich an existing catalogue row
-- without inventing a price or expiry value.
create or replace function public.commit_jev_barcode_mapping(p_capture uuid,p_user uuid,p_model text,p_decision jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage','private','pg_temp'
as $$
declare
  r public.ai_capture_runs%rowtype;
  p public.products%rowtype;
  plan jsonb;
  v_product uuid;
  v_barcode text;
  v_result jsonb;
begin
  select * into r from public.ai_capture_runs where id=p_capture and user_id=p_user for update;
  if not found then raise exception 'Unknown decision receipt'; end if;
  if not exists(select 1 from public.memberships where store_id=r.store_id and user_id=p_user and role in('owner','admin','editor'))
    then raise exception 'Not authorized' using errcode='42501'; end if;
  if r.state in('review','committed') then return jsonb_build_object('state',r.state,'decision',r.decision,'result',r.result); end if;
  if p_model is null or p_model not like '%jev%' or p_decision->>'status' is distinct from 'approved'
     or p_decision->>'policyVersion' is distinct from 'photo-auto-v1'
     or p_decision->'reasons' is distinct from '[]'::jsonb
    then raise exception 'Invalid barcode mapping decision'; end if;
  plan:=p_decision->'plan';
  if plan is null or coalesce((plan->>'new_product')::boolean,false)
     or plan->>'price_cents' is not null or plan->>'expiry_date' is not null
    then raise exception 'Not a barcode-only mapping'; end if;
  v_barcode:=plan->>'barcode';
  if v_barcode is null or not private.lixi_gtin_valid(v_barcode) then raise exception 'Invalid barcode'; end if;
  if r.input->>'evidencePath' is null
     or r.input->>'evidencePath'<>r.store_id::text||'/'||p_user::text||'/'||p_capture::text||'.jpg'
     or not exists(select 1 from storage.objects where bucket_id='capture-evidence' and name=r.input->>'evidencePath')
    then raise exception 'Private image evidence missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('jev-store:'||r.store_id::text,0));
  v_product:=(plan->>'product_id')::uuid;
  select * into p from public.products where id=v_product and store_id=r.store_id for update;
  if not found or not p.active or p.barcode is not null
     or p.internal_code is distinct from plan->>'internal_code'
     or p.updated_at is distinct from (plan->>'product_updated_at')::timestamptz
     or p.unit is distinct from plan->>'unit'
    then raise exception 'Catalogue changed during decision'; end if;
  if exists(select 1 from public.products where store_id=r.store_id and id<>p.id and lpad(barcode,14,'0')=lpad(v_barcode,14,'0'))
    then raise exception 'Barcode already mapped'; end if;
  update public.products set barcode=v_barcode,updated_at=now() where id=p.id and barcode is null;
  if not found then raise exception 'Barcode mapping lost race'; end if;
  v_result:=jsonb_build_object('product_id',p.id,'price_id',null,'batch_id',null,'barcode_mapped',true);
  update public.ai_capture_runs set state='committed',decision=p_decision,result=v_result,model=p_model,error_code=null,updated_at=now() where id=p_capture;
  return jsonb_build_object('state','committed','decision',p_decision,'result',v_result);
end
$$;
revoke all on function public.commit_jev_barcode_mapping(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_jev_barcode_mapping(uuid,uuid,text,jsonb) to service_role;
