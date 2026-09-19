-- Additive migration: preserve the existing store, users and catalogue.
create or replace function public.save_inventory_product(p_store uuid,p_product uuid,p_description text,p_barcode text,p_price numeric,p_location_code text,p_row text,p_number text)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_location uuid; v_existing public.product_locations%rowtype; v_product uuid;
begin
 if not exists(select 1 from public.memberships where store_id=p_store and user_id=(select auth.uid()) and role in ('owner','admin','editor')) then raise exception 'No editing permission' using errcode='42501'; end if;
 if nullif(btrim(p_description),'') is null then raise exception 'Description is required' using errcode='22023'; end if;
 if p_price is not null and (p_price::text in ('NaN','Infinity','-Infinity') or p_price<0 or p_price>9999999999.99 or round(p_price,2)<>p_price) then raise exception 'Invalid catalogue price' using errcode='22023'; end if;
 select id into v_product from public.products where id=p_product and store_id=p_store for update;
 if v_product is null then raise exception 'Product not found' using errcode='22023'; end if;
 if nullif(btrim(p_location_code),'') is not null then
  select id into v_location from public.locations where store_id=p_store and code=p_location_code;
  if v_location is null then raise exception 'Unknown location' using errcode='22023'; end if;
 elsif nullif(btrim(p_row),'') is not null or nullif(btrim(p_number),'') is not null then raise exception 'Select a location for row and number' using errcode='22023';
 end if;
 select * into v_existing from public.product_locations where store_id=p_store and product_id=p_product and is_current for update;
 update public.products set description=btrim(p_description),barcode=nullif(btrim(p_barcode),''),catalog_price=p_price,updated_at=now() where id=p_product and store_id=p_store;
 if v_existing.location_id is distinct from v_location or v_existing.row_label is distinct from nullif(btrim(p_row),'') or v_existing.number_label is distinct from nullif(btrim(p_number),'') then
  update public.product_locations set is_current=false where product_id=p_product and store_id=p_store and is_current;
  if v_location is not null then
   insert into public.product_locations(store_id,product_id,location_id,row_label,number_label,is_current) values(p_store,p_product,v_location,nullif(btrim(p_row),''),nullif(btrim(p_number),''),true);
  end if;
 end if;
 return p_product;
end $$;
revoke all on function public.save_inventory_product(uuid,uuid,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.save_inventory_product(uuid,uuid,text,text,numeric,text,text,text) to authenticated;
