
drop function if exists public.commit_smart_capture(uuid,uuid,uuid,text,integer,date,text,text,numeric,uuid,text,text,jsonb);
create or replace function public.commit_smart_capture(
  p_id uuid,p_store uuid,p_product uuid,p_unit text,p_observed_at timestamptz,
  p_price_cents integer,p_expiry date,p_expiry_kind text,p_lot text,p_quantity numeric,
  p_location uuid,p_expiry_source text,p_evidence text,p_metadata jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_price uuid;v_batch uuid;v_location uuid:=p_location;v_ref text:=coalesce(p_evidence,'smart:'||p_id::text);
begin
 if p_id is null or p_store is null or p_product is null or p_observed_at is null then raise exception 'Missing smart capture identifiers'; end if;
 if p_price_cents is null and p_expiry is null then raise exception 'Smart capture contains neither a price nor an expiry date'; end if;
 if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or p_metadata->>'reviewed' is distinct from 'true' then raise exception 'Smart capture requires explicit human review'; end if;
 if p_observed_at>now()+interval '5 minutes' or p_observed_at<now()-interval '1 year' then raise exception 'Invalid capture timestamp. Check device clock.'; end if;
 if v_location is null then select pl.location_id into v_location from public.product_locations pl where pl.store_id=p_store and pl.product_id=p_product and pl.is_current=true limit 1; end if;
 if p_price_cents is not null then v_price:=public.commit_capture_price(p_id,p_store,p_product,p_price_cents,p_unit,p_observed_at,p_evidence,p_metadata); end if;
 if p_expiry is not null then v_batch:=public.commit_expiry_batch(p_id,p_store,p_product,p_expiry,coalesce(p_expiry_kind,'unknown'),coalesce(p_lot,''),p_quantity,v_location,coalesce(p_expiry_source,'manual'),v_ref,null,p_metadata); end if;
 return jsonb_build_object('price_id',v_price,'batch_id',v_batch,'location_id',v_location);
end $$;
revoke all on function public.commit_smart_capture(uuid,uuid,uuid,text,timestamptz,integer,date,text,text,numeric,uuid,text,text,jsonb) from public,anon;
grant execute on function public.commit_smart_capture(uuid,uuid,uuid,text,timestamptz,integer,date,text,text,numeric,uuid,text,text,jsonb) to authenticated;
