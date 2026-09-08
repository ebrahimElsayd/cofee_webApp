-- Public, non-sensitive branding bootstrap used before staff authentication.
create or replace function public.get_public_cafe_branding(target_cafe_id uuid)
returns table (cafe_id uuid, cafe_name text, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select id, cafe_name, logo_url
  from public.cafe_settings
  where id = target_cafe_id
  limit 1
$$;

revoke all on function public.get_public_cafe_branding(uuid) from public;
grant execute on function public.get_public_cafe_branding(uuid) to anon, authenticated;
