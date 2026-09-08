-- Publish catalog changes so customer menus can invalidate their cache.
do $$
begin
  begin alter publication supabase_realtime add table public.menu_products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.menu_categories; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.modifier_groups; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.modifier_options; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.product_modifier_groups; exception when duplicate_object then null; end;
end $$;
