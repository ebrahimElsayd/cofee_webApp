-- Public, CDN-friendly product images. The database stores only a versioned URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff can upload product images" on storage.objects;
create policy "staff can upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_staff_user());

drop policy if exists "staff can update product images" on storage.objects;
create policy "staff can update product images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_staff_user())
  with check (bucket_id = 'product-images' and public.is_staff_user());

drop policy if exists "staff can delete product images" on storage.objects;
create policy "staff can delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_staff_user());
