-- No credentials are stored in migrations. OPENROUTER_API_KEY is an Edge secret.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
create table if not exists public.ai_capture_runs(
 id uuid primary key,store_id uuid not null references public.stores(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),image_hash text not null check(image_hash ~ '^[a-f0-9]{64}$'),
 input jsonb not null,state text not null default 'processing' check(state in('processing','review','committed','failed')),
 model text,decision jsonb,result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,image_hash)
);
alter table public.ai_capture_runs add column if not exists attempts integer not null default 0;
alter table public.ai_capture_runs add column if not exists error_code text;
create index if not exists jev_capture_pending on public.ai_capture_runs(store_id,state,updated_at);
create index if not exists jev_capture_user on public.ai_capture_runs(user_id);
alter table public.ai_capture_runs enable row level security;
revoke all on public.ai_capture_runs from anon,authenticated;
grant select on public.ai_capture_runs to authenticated;
drop policy if exists ai_capture_runs_store_read on public.ai_capture_runs;
create policy ai_capture_runs_store_read on public.ai_capture_runs for select to authenticated using(exists(select 1 from public.memberships m where m.store_id=ai_capture_runs.store_id and m.user_id=(select auth.uid())));
create table if not exists public.jev_automation_settings(
 store_id uuid primary key references public.stores(id) on delete cascade,
 enabled boolean not null default true,timezone text not null default 'Europe/Athens' check(timezone='Europe/Athens'),
 updated_at timestamptz not null default now()
);
insert into public.jev_automation_settings(store_id) select id from public.stores where code='MAIN' on conflict do nothing;
alter table public.jev_automation_settings enable row level security;
revoke all on public.jev_automation_settings from anon,authenticated;
grant select,update on public.jev_automation_settings to authenticated;
create policy jev_settings_read on public.jev_automation_settings for select to authenticated using(exists(select 1 from public.memberships m where m.store_id=jev_automation_settings.store_id and m.user_id=(select auth.uid())));
create policy jev_settings_update on public.jev_automation_settings for update to authenticated using(exists(select 1 from public.memberships m where m.store_id=jev_automation_settings.store_id and m.user_id=(select auth.uid()) and m.role in('owner','admin'))) with check(exists(select 1 from public.memberships m where m.store_id=jev_automation_settings.store_id and m.user_id=(select auth.uid()) and m.role in('owner','admin')));
create table if not exists public.jev_sync_runs(
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id) on delete cascade,
 slot timestamptz not null,state text not null default 'queued' check(state in('queued','running','completed','blocked','failed')),
 summary jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),finished_at timestamptz,unique(store_id,slot)
);
create index if not exists jev_sync_store_time on public.jev_sync_runs(store_id,created_at desc);
alter table public.jev_sync_runs enable row level security;
revoke all on public.jev_sync_runs from anon,authenticated;
grant select on public.jev_sync_runs to authenticated;
create policy jev_sync_read on public.jev_sync_runs for select to authenticated using(exists(select 1 from public.memberships m where m.store_id=jev_sync_runs.store_id and m.user_id=(select auth.uid())));
create table if not exists private.jev_job_tickets(token_hash text primary key,run_id uuid not null references public.jev_sync_runs(id) on delete cascade,expires_at timestamptz not null,used_at timestamptz);
create index if not exists jev_ticket_run on private.jev_job_tickets(run_id);
create table if not exists private.jev_call_budget(store_id uuid not null,called_at timestamptz not null default now());
create index if not exists jev_budget_scope on private.jev_call_budget(store_id,called_at);
revoke all on private.jev_job_tickets,private.jev_call_budget from public,anon,authenticated;
create or replace function public.jev_take_budget(p_store uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('jev-budget:'||p_store::text,0));
 if (select count(*) from private.jev_call_budget where store_id=p_store and called_at>now()-interval '1 minute')>=40 or (select count(*) from private.jev_call_budget where store_id=p_store and called_at>date_trunc('day',now() at time zone 'Europe/Athens') at time zone 'Europe/Athens')>=1000 then return false;end if;
 delete from private.jev_call_budget where store_id=p_store and called_at<now()-interval '2 days';
 insert into private.jev_call_budget(store_id) values(p_store);return true;
end $$;
create or replace function public.reserve_jev_capture(p_id uuid,p_store uuid,p_user uuid,p_hash text,p_image_hash text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.ai_capture_runs%rowtype;
begin
 if not exists(select 1 from public.memberships where store_id=p_store and user_id=p_user and role in('owner','admin','editor')) then raise exception 'Not authorized' using errcode='42501';end if;
 if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_image_hash is null or p_image_hash !~ '^[a-f0-9]{64}$' or p_input is null or octet_length(p_input::text)>65536 then raise exception 'Invalid capture request';end if;
 perform pg_advisory_xact_lock(hashtextextended('jev-store:'||p_store::text,0));
 select * into r from public.ai_capture_runs where id=p_id for update;
 if found then
  if r.user_id<>p_user or r.store_id<>p_store or r.input_hash<>p_hash then raise exception 'Capture ID reused with different input';end if;
  if r.state in('review','committed') then return jsonb_build_object('cached',true,'state',r.state,'decision',r.decision,'result',r.result);end if;
  if r.state='processing' and r.updated_at>now()-interval '60 seconds' then return jsonb_build_object('busy',true);end if;
  if r.attempts>=3 then update public.ai_capture_runs set state='review',error_code='retry_limit' where id=p_id;return jsonb_build_object('cached',true,'state','review');end if;
  update public.ai_capture_runs set state='processing',updated_at=now() where id=p_id;return jsonb_build_object('reserved',true);
 end if;
 if exists(select 1 from public.ai_capture_runs where store_id=p_store and image_hash=p_image_hash) then return jsonb_build_object('duplicate',true,'state','duplicate');end if;
 if (select count(*) from public.ai_capture_runs where user_id=p_user and created_at>now()-interval '1 minute')>=20 then raise exception 'Capture rate limit exceeded';end if;
 insert into public.ai_capture_runs(id,store_id,user_id,input_hash,image_hash,input) values(p_id,p_store,p_user,p_hash,p_image_hash,p_input);return jsonb_build_object('reserved',true);
end $$;
create or replace function private.lixi_gtin_valid(s text) returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare total integer:=0;i integer;w integer:=3;
begin
 if s is null or s !~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' then return false;end if;
 for i in reverse length(s)-1..1 loop total:=total+substring(s,i,1)::integer*w;w:=4-w;end loop;
 return (10-total%10)%10=right(s,1)::integer;
end $$;
create or replace function public.finish_jev_capture(p_id uuid,p_user uuid,p_model text,p_decision jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,storage,private,pg_temp as $$
declare r public.ai_capture_runs%rowtype;p public.products%rowtype;plan jsonb;v_product uuid;v_price uuid;v_batch uuid;v_location uuid;v_code text;v_barcode text;v_cents integer;v_expiry date;v_kind text;v_observed timestamptz;v_evidence text;v_meta jsonb;v_result jsonb;
begin
 select * into r from public.ai_capture_runs where id=p_id and user_id=p_user for update;
 if not found then raise exception 'Unknown decision receipt';end if;
 if not exists(select 1 from public.memberships where store_id=r.store_id and user_id=p_user and role in('owner','admin','editor')) then raise exception 'Not authorized' using errcode='42501';end if;
 if r.state in('review','committed') then return jsonb_build_object('state',r.state,'decision',r.decision,'result',r.result);end if;
 if p_model is null or p_model not like '%jev%' or length(p_model)>100 or p_decision is null or octet_length(p_decision::text)>32768 then raise exception 'Invalid decision';end if;
 if p_decision->>'status' is distinct from 'approved' or not exists(select 1 from public.jev_automation_settings where store_id=r.store_id and enabled) then
  update public.ai_capture_runs set state='review',decision=p_decision,model=p_model,error_code=null,updated_at=now() where id=p_id;
  return jsonb_build_object('state','review','decision',p_decision);
 end if;
 if p_decision->>'policyVersion' is distinct from 'photo-auto-v1' or p_decision->'reasons' is distinct from '[]'::jsonb then raise exception 'Decision policy rejected';end if;
 plan:=p_decision->'plan';v_observed:=(r.input->>'observedAt')::timestamptz;v_evidence:=r.input->>'evidencePath';
 if v_observed is null or v_observed>now()+interval '5 minutes' or v_observed<now()-interval '1 year' then raise exception 'Invalid observation timestamp';end if;
 if v_evidence is null or v_evidence<>r.store_id::text||'/'||p_user::text||'/'||p_id::text||'.jpg' or not exists(select 1 from storage.objects where bucket_id='capture-evidence' and name=v_evidence) then raise exception 'Private image evidence missing';end if;
 v_code:=plan->>'internal_code';v_barcode:=plan->>'barcode';
 if v_code is null or v_code !~ '^[0-9]{7}$' or nullif(plan->>'unit','') is null or coalesce(length(plan->>'description'),0)<3 then raise exception 'Incomplete catalogue evidence';end if;
 if v_barcode is not null and not private.lixi_gtin_valid(v_barcode) then raise exception 'Invalid barcode';end if;
 perform pg_advisory_xact_lock(hashtextextended('jev-store:'||r.store_id::text,0));
 select * into p from public.products where store_id=r.store_id and internal_code=v_code for update;
 if coalesce((plan->>'new_product')::boolean,false) then
  if found or v_barcode is null then raise exception 'New item conflicts or lacks decoded barcode';end if;
  if exists(select 1 from public.products where store_id=r.store_id and lpad(barcode,14,'0')=lpad(v_barcode,14,'0')) then raise exception 'Barcode already mapped';end if;
  insert into public.products(store_id,internal_code,barcode,description,unit,source) values(r.store_id,v_code,v_barcode,plan->>'description',plan->>'unit','jev-photo-import') returning id into v_product;
 else
  if not found or p.id::text is distinct from plan->>'product_id' or not p.active or p.updated_at is distinct from (plan->>'product_updated_at')::timestamptz or p.unit is distinct from plan->>'unit' then raise exception 'Catalogue changed during decision';end if;
  v_product:=p.id;
  if v_barcode is not null then
   if p.barcode is not null and lpad(p.barcode,14,'0')<>lpad(v_barcode,14,'0') then raise exception 'Barcode disagreement';end if;
   if p.barcode is null then
    if exists(select 1 from public.products where store_id=r.store_id and id<>p.id and lpad(barcode,14,'0')=lpad(v_barcode,14,'0')) then raise exception 'Barcode already mapped';end if;
    update public.products set barcode=v_barcode,updated_at=now() where id=p.id;
   end if;
  end if;
 end if;
 select pl.location_id into v_location from public.product_locations pl join public.locations l on l.id=pl.location_id and l.store_id=r.store_id where pl.product_id=v_product and pl.store_id=r.store_id and pl.is_current limit 1;
 v_cents:=(plan->>'price_cents')::integer;v_expiry:=(plan->>'expiry_date')::date;v_kind:=plan->>'expiry_kind';
 if v_cents is null and v_expiry is null then raise exception 'No captured values';end if;
 if v_cents is not null and (v_cents<0 or v_cents>999999999) then raise exception 'Invalid price';end if;
 if v_expiry is not null and (v_expiry<current_date-366 or v_expiry>current_date+5500 or v_kind is null or v_kind not in('expiry','best_before','sell_by')) then raise exception 'Invalid expiry';end if;
 v_meta:=jsonb_build_object('reviewed',false,'approval_source','jev_policy','decision_id',p_id,'model',p_model,'policy_version','photo-auto-v1','image_sha256',r.image_hash);
 if v_cents is not null then insert into public.price_observations(store_id,product_id,internal_code,observed_price,observed_at,source_type,source_ref,barcode,verified,note,client_event_id,recorded_by,capture_metadata) values(r.store_id,v_product,v_code,v_cents/100.0,v_observed,'shelf_photo',v_evidence,v_barcode,false,'Automatic Jev policy; not human reviewed.',p_id,p_user,v_meta) returning id into v_price;end if;
 if v_expiry is not null then insert into public.product_batches(store_id,product_id,location_id,lot_number,expiry_date,expiry_kind,quantity,source_type,source_ref,capture_metadata,client_event_id,captured_by) values(r.store_id,v_product,v_location,nullif(plan->>'lot_number',''),v_expiry,v_kind,null,'ocr',v_evidence,v_meta,p_id,p_user) returning id into v_batch;end if;
 v_result:=jsonb_build_object('product_id',v_product,'price_id',v_price,'batch_id',v_batch);
 update public.ai_capture_runs set state='committed',decision=p_decision,result=v_result,model=p_model,error_code=null,updated_at=now() where id=p_id;
 return jsonb_build_object('state','committed','decision',p_decision,'result',v_result);
end $$;
create or replace function private.jev_slot_due(p_at timestamptz) returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$select (p_at at time zone 'Europe/Athens')::time between time '07:00' and time '09:00:59' and extract(minute from p_at at time zone 'Europe/Athens')::integer%20=0$$;
create or replace function public.claim_jev_job(p_ticket text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions,pg_temp as $$
declare v_run uuid;r public.jev_sync_runs%rowtype;
begin
 update private.jev_job_tickets set used_at=now() where token_hash=encode(extensions.digest(p_ticket,'sha256'),'hex') and used_at is null and expires_at>now() returning run_id into v_run;
 if v_run is null then raise exception 'Invalid scheduler ticket' using errcode='42501';end if;
 update public.jev_sync_runs set state='running' where id=v_run and state='queued' returning * into r;
 if not found then raise exception 'Job already claimed';end if;
 return jsonb_build_object('id',r.id,'store_id',r.store_id);
end $$;
create or replace function private.dispatch_jev_jobs() returns integer language plpgsql security definer set search_path=pg_catalog,public,private,extensions,net,pg_temp as $$
declare s record;v_run uuid;v_ticket text;sent integer:=0;
begin
 if not private.jev_slot_due(now()) then return 0;end if;
 update public.jev_sync_runs set state='failed',finished_at=now(),summary=jsonb_build_object('error','worker_timeout') where state in('queued','running') and created_at<now()-interval '15 minutes';
 for s in select store_id from public.jev_automation_settings where enabled loop
  v_run:=null;
  insert into public.jev_sync_runs(store_id,slot) values(s.store_id,date_trunc('minute',now())) on conflict do nothing returning id into v_run;
  if v_run is null then continue;end if;
  v_ticket:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into private.jev_job_tickets(token_hash,run_id,expires_at) values(encode(extensions.digest(v_ticket,'sha256'),'hex'),v_run,now()+interval '10 minutes');
  perform net.http_post(url:='https://zgdfgznwxioxmlrvssaa.supabase.co/functions/v1/lixi-jev',headers:=jsonb_build_object('Content-Type','application/json','x-lixi-job',v_ticket),body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=120000);
  sent:=sent+1;
 end loop;
 delete from private.jev_job_tickets where expires_at<now()-interval '1 day';return sent;
end $$;
revoke all on function public.reserve_jev_capture(uuid,uuid,uuid,text,text,jsonb),public.finish_jev_capture(uuid,uuid,text,jsonb),public.jev_take_budget(uuid),public.claim_jev_job(text) from public,anon,authenticated;
grant execute on function public.reserve_jev_capture(uuid,uuid,uuid,text,text,jsonb),public.finish_jev_capture(uuid,uuid,text,jsonb),public.jev_take_budget(uuid),public.claim_jev_job(text) to service_role;
revoke all on function private.dispatch_jev_jobs(),private.jev_slot_due(timestamptz),private.lixi_gtin_valid(text) from public,anon,authenticated;
-- UTC scheduler with an Athens wall-clock guard handles summer and winter automatically.
select cron.schedule('lixi-jev-morning','*/20 * * * *','select private.dispatch_jev_jobs();');
