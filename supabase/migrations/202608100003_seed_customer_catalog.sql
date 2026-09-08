-- Initial catalog shared by the customer and future barista applications.
with cafe as (select '00000000-0000-0000-0000-000000000001'::uuid as id)
insert into public.menu_products (cafe_id, category_id, slug, name, name_ar, description, image_url, base_price, availability, allows_notes)
select cafe.id, cat.id, p.slug, p.name, p.name_ar, p.description, p.image_url, p.price, 'available', p.allows_notes
from cafe
join (values
  ('cardamom-cappuccino','Cardamom Cappuccino','كابتشينو هيل','Velvety cappuccino finished with fragrant Arabic cardamom','/images/products/cardamom-cappuccino.webp',95,'specialty',true),
  ('signature-espresso','Signature Espresso','إسبريسو مميز','A rich and balanced signature espresso shot','/images/products/signature-espresso.webp',85,'espresso',true),
  ('cold-brew-reserve','Cold Brew Reserve','كولد برو المميز','Slow-steeped reserve coffee served over ice','/images/products/cold-brew-reserve.webp',110,'cold',true),
  ('ice-mocha-deluxe','Ice Mocha Deluxe','موكا مثلج ديلوكس','Espresso, premium chocolate and milk served over ice','/images/products/ice-mocha-deluxe.webp',125,'cold',true),
  ('royal-matcha','Royal Matcha','ماتشا ملكي','Ceremonial matcha whisked with your choice of milk','/images/products/royal-matcha.webp',130,'specialty',true),
  ('black-tea','Classic Black Tea','شاي سادة','Freshly brewed classic black tea served hot','/images/products/black-tea.webp',45,'tea',true),
  ('fresh-orange-juice','Fresh Orange Juice','عصير برتقال فريش','Freshly squeezed oranges prepared when you order','/images/products/fresh-orange-juice.webp',90,'cold',true),
  ('coca-cola','Coca-Cola','كوكاكولا','Chilled Coca-Cola served ready to enjoy','/images/products/coca-cola.webp',40,'soft-drinks',false),
  ('sparkling-water','Sparkling Water','مياه غازية','Cold sparkling mineral water','/images/products/sparkling-water.webp',35,'soft-drinks',false),
  ('lotus-cheesecake','Lotus Cheesecake','تشيز كيك لوتس','Creamy cheesecake with a spiced Lotus biscuit finish','/images/products/lotus-cheesecake.webp',145,'food',true),
  ('chocolate-brownie','Chocolate Brownie','براوني شوكولاتة','Warm fudgy chocolate brownie','/images/products/chocolate-brownie.webp',105,'food',true)
) p(slug,name,name_ar,description,image_url,price,category_code,allows_notes) on true
join public.menu_categories cat on cat.cafe_id = cafe.id and cat.code = p.category_code
on conflict (cafe_id, slug) do update set
  category_id = excluded.category_id, name = excluded.name, name_ar = excluded.name_ar,
  description = excluded.description, image_url = excluded.image_url,
  base_price = excluded.base_price, allows_notes = excluded.allows_notes,
  availability = excluded.availability, updated_at = now();

with cafe as (select '00000000-0000-0000-0000-000000000001'::uuid as id)
insert into public.modifier_groups (cafe_id, code, name, name_ar, selection_type, is_required, sort_order)
select cafe.id, g.code, g.name, g.name_ar, g.selection_type, g.is_required, g.sort_order
from cafe cross join (values
  ('roast','Coffee Roast','درجة التحميص','single',true,1),
  ('sugar','Sugar Level','مستوى السكر','single',true,2),
  ('milk','Milk Type','نوع الحليب','single',true,3),
  ('coffee-extras','Extra Flavour','إضافة نكهة','multiple',false,4),
  ('tea-strength','Tea Strength','تركيز الشاي','single',true,1),
  ('size','Cup Size','حجم الكوب','single',true,1),
  ('ice','Ice Level','مستوى الثلج','single',true,2),
  ('dessert-extras','Dessert Extras','إضافات الحلو','multiple',false,1)
) g(code,name,name_ar,selection_type,is_required,sort_order)
on conflict (cafe_id, code) do update set name = excluded.name, name_ar = excluded.name_ar,
  selection_type = excluded.selection_type, is_required = excluded.is_required, sort_order = excluded.sort_order;

insert into public.modifier_options (group_id, code, name, name_ar, price_delta, is_available, sort_order)
select g.id, o.code, o.name, o.name_ar, o.price_delta, o.is_available, o.sort_order
from public.modifier_groups g
join (values
  ('roast','light','Light','خفيف',0,true,1),('roast','medium','Medium','متوسط',0,true,2),('roast','dark','Dark Roast','داكن',0,true,3),
  ('sugar','none','None','بدون',0,true,1),('sugar','light','Light','خفيف',0,true,2),('sugar','medium','Medium','متوسط',0,true,3),('sugar','extra','Extra','زيادة',0,true,4),
  ('milk','natural','Natural Milk','حليب طبيعي',0,true,1),('milk','almond','Almond Milk','حليب لوز',15,true,2),('milk','oat','Oat Milk','حليب شوفان',15,false,3),
  ('coffee-extras','vanilla','Vanilla','فانيليا',10,true,1),('coffee-extras','caramel','Caramel','كراميل',10,true,2),('coffee-extras','hazelnut','Hazelnut','بندق',15,false,3),
  ('tea-strength','light','Light','خفيف',0,true,1),('tea-strength','regular','Regular','عادي',0,true,2),('tea-strength','strong','Strong','ثقيل',0,true,3),
  ('size','regular','Regular','عادي',0,true,1),('size','large','Large','كبير',20,true,2),
  ('ice','none','No Ice','بدون',0,true,1),('ice','regular','Regular','عادي',0,true,2),('ice','extra','Extra Ice','زيادة',0,true,3),
  ('dessert-extras','caramel-sauce','Caramel Sauce','صوص كراميل',15,true,1),('dessert-extras','ice-cream','Ice Cream','آيس كريم',25,true,2),('dessert-extras','cream','Whipped Cream','كريمة',15,false,3)
) o(group_code,code,name,name_ar,price_delta,is_available,sort_order) on o.group_code = g.code
on conflict (group_id, code) do update set name = excluded.name, name_ar = excluded.name_ar,
  price_delta = excluded.price_delta, is_available = excluded.is_available, sort_order = excluded.sort_order;

insert into public.product_modifier_groups (product_id, group_id, sort_order)
select p.id, g.id, x.sort_order
from public.menu_products p
join public.modifier_groups g on g.cafe_id = p.cafe_id
join (values
  ('cardamom-cappuccino','roast',1),('cardamom-cappuccino','sugar',2),('cardamom-cappuccino','milk',3),('cardamom-cappuccino','coffee-extras',4),
  ('signature-espresso','roast',1),('signature-espresso','sugar',2),
  ('cold-brew-reserve','sugar',1),('cold-brew-reserve','ice',2),('cold-brew-reserve','coffee-extras',3),
  ('ice-mocha-deluxe','sugar',1),('ice-mocha-deluxe','milk',2),('ice-mocha-deluxe','ice',3),('ice-mocha-deluxe','coffee-extras',4),
  ('royal-matcha','sugar',1),('royal-matcha','milk',2),('black-tea','tea-strength',1),('black-tea','sugar',2),
  ('fresh-orange-juice','size',1),('fresh-orange-juice','sugar',2),('fresh-orange-juice','ice',3),('lotus-cheesecake','dessert-extras',1),('chocolate-brownie','dessert-extras',1)
) x(slug,group_code,sort_order) on x.slug = p.slug and x.group_code = g.code
on conflict (product_id, group_id) do update set sort_order = excluded.sort_order;
