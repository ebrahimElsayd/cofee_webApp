alter table public.menu_products
  add column if not exists legacy_image_data text;

update public.menu_products
set legacy_image_data = image_url,
    image_url = 'https://ydzzqikzrhmujjrivpat.supabase.co/storage/v1/object/public/product-images/00000000-0000-0000-0000-000000000001/de1318fa-4e5a-4712-b5a1-1b38ded415e7/migrated-embedded-20260908.jpg',
    updated_at = now()
where id = 'de1318fa-4e5a-4712-b5a1-1b38ded415e7'
  and image_url like 'data:image/%';
