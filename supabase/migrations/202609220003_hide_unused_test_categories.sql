-- Keep historical category rows, but remove known unused test categories from staff/customer selectors.
update public.menu_categories as category
set is_active = false
where lower(trim(category.name)) in ('كيرو kero', 'beautiful drink', 'ابراهيم')
  and not exists (
    select 1
    from public.menu_products as product
    where product.category_id = category.id
      and product.availability <> 'hidden'
  );
