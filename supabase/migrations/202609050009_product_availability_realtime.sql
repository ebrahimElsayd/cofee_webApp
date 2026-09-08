do $$
begin
  begin
    alter publication supabase_realtime add table public.product_availability;
  exception when duplicate_object then
    null;
  end;
end $$;
