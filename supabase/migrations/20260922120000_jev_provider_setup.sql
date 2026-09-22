-- Private, per-store provider setup. Keys are never part of the frontend bundle.
create or replace function public.jev_provider_key(p_store uuid)
returns text language sql security definer set search_path=pg_catalog,vault,pg_temp as $$
 select decrypted_secret from vault.decrypted_secrets where name='lixi_openrouter_'||p_store::text limit 1;
$$;
create or replace function public.configure_jev_provider(p_store uuid,p_user uuid,p_key text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,vault,pg_temp as $$
declare v_id uuid;
begin
 if not exists(select 1 from public.memberships where store_id=p_store and user_id=p_user and role='owner') then raise exception 'Only the store owner may configure the provider' using errcode='42501'; end if;
 if p_key is null or p_key !~ '^sk-or-[A-Za-z0-9_-]{20,190}$' then raise exception 'Invalid provider credential format'; end if;
 perform pg_advisory_xact_lock(hashtextextended('jev-config:'||p_store::text,0));
 select id into v_id from vault.secrets where name='lixi_openrouter_'||p_store::text;
 if v_id is null then perform vault.create_secret(p_key,'lixi_openrouter_'||p_store::text,'Leaksy OpenRouter provider credential');
 else perform vault.update_secret(v_id,p_key); end if;
 return true;
end $$;
revoke all on function public.jev_provider_key(uuid),public.configure_jev_provider(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.jev_provider_key(uuid),public.configure_jev_provider(uuid,uuid,text) to service_role;
create index if not exists product_batches_captured_by_idx on public.product_batches(captured_by);
create index if not exists bootstrap_tokens_store_idx on private.bootstrap_tokens(store_id);
