-- Lets the Edge Function read its two secrets from Supabase Vault (alternative to `supabase secrets set`).
-- Only service_role can execute it; anon/authenticated cannot (and cannot read vault tables).
create or replace function public.get_app_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if secret_name not in ('gemini_api_key', 'team_code') then
    raise exception 'unknown secret';
  end if;
  return (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = secret_name order by ds.created_at desc limit 1);
end $$;

revoke all on function public.get_app_secret(text) from public, anon, authenticated;
grant execute on function public.get_app_secret(text) to service_role;
